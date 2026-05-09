import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import { generateAiReasons } from './gemini.service.js';
import { getById } from './users.service.js';
import { serializeOpportunityTimes } from '../utils/time.js';
import type { Database } from '../types/supabase.generated.js';

type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];

export interface OpportunityCard extends OpportunityRow {
  match_score?: number;
  ai_reason?: string;
  attendee_count?: number;
  names_visible?: string[];
  distance_km?: number | null;
}

export interface FeedResponse {
  today_tomorrow: OpportunityCard[];
  this_week: OpportunityCard[];
  try_new: OpportunityCard[];
}

const FEED_TOP_N = 30;
const NAMES_VISIBLE_MAX = 6;
const TODAY_TOMORROW_HOURS = 36;
const THIS_WEEK_HOURS = 168;

interface MatchRow {
  event_id: string;
  score: number;
  opportunities: OpportunityRow | null;
}

export async function buildFeed(userId: string, cityFilter?: string): Promise<FeedResponse> {
  const user = await getById(userId);
  if (!user) throw AppError.notFound('User profile not found', 'user_not_found');

  const effectiveCity = cityFilter ?? user.city ?? null;

  // 1) Pull personalised candidates from event_matches.
  let query = supabaseAdmin
    .from('event_matches')
    .select('event_id, score, opportunities!inner(*)')
    .eq('user_id', userId)
    .gt('score', 0)
    .order('score', { ascending: false })
    .order('event_id', { ascending: true })
    .limit(FEED_TOP_N);

  if (effectiveCity) {
    // Filter on the joined opportunities.city — `opportunities!inner` makes it
    // a real INNER JOIN so this filter actually applies.
    query = query.eq('opportunities.city', effectiveCity);
  }

  const { data: matchRowsData, error: matchErr } = await query;
  if (matchErr) throw AppError.upstream('Failed to load feed candidates', matchErr.message);
  const matchRows = (matchRowsData ?? []) as unknown as MatchRow[];

  const opportunities = matchRows
    .map((m) => m.opportunities)
    .filter((o): o is OpportunityRow => o !== null);

  // 2) Bucket by start_at proximity.
  const now = Date.now();
  const todayTomorrowCut = now + TODAY_TOMORROW_HOURS * 3600 * 1000;
  const thisWeekCut = now + THIS_WEEK_HOURS * 3600 * 1000;

  const todayTomorrow: OpportunityRow[] = [];
  const thisWeek: OpportunityRow[] = [];
  const later: OpportunityRow[] = [];

  for (const o of opportunities) {
    if (!o.start_at) {
      later.push(o);
      continue;
    }
    // start_at is wall-clock UTC string (no tz); treat as UTC for bucket math.
    const ts = parseWallClockUtc(o.start_at);
    if (ts < now) continue; // ignore past events
    if (ts <= todayTomorrowCut) todayTomorrow.push(o);
    else if (ts <= thisWeekCut) thisWeek.push(o);
    else later.push(o);
  }

  // 3) "try_new" — top 1–2 from `later` whose interests don't overlap the user's.
  const userInterests = new Set(user.interests ?? []);
  const tryNew = later.filter((o) => !o.interests.some((i) => userInterests.has(i))).slice(0, 2);

  // 4) Decorate every opportunity we'll return.
  const visible = [...todayTomorrow, ...thisWeek, ...tryNew];
  const decorations = await decorate(visible, matchRows, user);

  // 5) AI reasons (best-effort; errors → empty map, decorate() defaults to '').
  const aiReasons = await generateAiReasons(
    {
      city: user.city,
      interests: user.interests ?? [],
      bio: user.bio,
    },
    visible.map((o) => ({
      id: o.id,
      title: o.title,
      short_description: o.short_description,
      city: o.city,
      interests: o.interests ?? [],
    })),
  );

  const buildCard = (o: OpportunityRow): OpportunityCard => {
    const dec = decorations.get(o.id);
    return {
      ...serializeOpportunityTimes(o),
      match_score: dec?.match_score,
      attendee_count: dec?.attendee_count ?? 0,
      names_visible: dec?.names_visible ?? [],
      distance_km: null, // Frontend computes from city centroids per contract.
      ai_reason: aiReasons[o.id] ?? '',
    };
  };

  return {
    today_tomorrow: todayTomorrow.map(buildCard),
    this_week: thisWeek.map(buildCard),
    try_new: tryNew.map(buildCard),
  };
}

interface Decoration {
  match_score: number;
  attendee_count: number;
  names_visible: string[];
}

async function decorate(
  opportunities: OpportunityRow[],
  matchRows: MatchRow[],
  user: { id: string; show_name_publicly: boolean },
): Promise<Map<string, Decoration>> {
  const out = new Map<string, Decoration>();
  if (opportunities.length === 0) return out;
  const ids = opportunities.map((o) => o.id);

  // Pull all attendees (status IN joining/attended) for these events at once.
  // For each row we also need the attendee user's display_name +
  // show_name_publicly + the event-level show_name_publicly.
  const { data: attendeesData, error: attendeesErr } = await supabaseAdmin
    .from('event_attendees')
    .select('event_id, status, show_name_publicly, users:user_id(display_name, show_name_publicly)')
    .in('event_id', ids)
    .in('status', ['joining', 'attended']);
  if (attendeesErr)
    throw AppError.upstream('Failed to load attendee decoration', attendeesErr.message);

  const counts = new Map<string, number>();
  const names = new Map<string, string[]>();
  type AttendeeRow = {
    event_id: string;
    status: string;
    show_name_publicly: boolean;
    users: { display_name: string | null; show_name_publicly: boolean } | null;
  };
  for (const row of (attendeesData ?? []) as unknown as AttendeeRow[]) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
    const eventOptIn = row.show_name_publicly === true;
    const userOptIn = row.users?.show_name_publicly === true;
    if (eventOptIn && userOptIn && row.users?.display_name) {
      const list = names.get(row.event_id) ?? [];
      if (list.length < NAMES_VISIBLE_MAX) {
        list.push(row.users.display_name);
        names.set(row.event_id, list);
      }
    }
  }

  const scoreById = new Map<string, number>();
  for (const m of matchRows) scoreById.set(m.event_id, m.score);

  for (const o of opportunities) {
    out.set(o.id, {
      match_score: scoreById.get(o.id) ?? 0,
      attendee_count: counts.get(o.id) ?? 0,
      names_visible: names.get(o.id) ?? [],
    });
  }
  return out;
}

// opportunities.start_at is timestamp without tz — Supabase returns it as
// 'YYYY-MM-DDTHH:mm:ss[.SSS]' with no offset. Treat the wall-clock as UTC
// for bucket math (matching how we wrote it; tz adjustment is a presentation
// concern handled in serializeOpportunityTimes).
function parseWallClockUtc(s: string): number {
  return Date.parse(s.endsWith('Z') ? s : `${s}Z`);
}
