import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import {
  generateAiReasons,
  HEALTH_INTEREST_TAGS,
  DISCOUNT_INTEREST_TAGS,
  type ClassifiedInterest,
} from './gemini.service.js';
import { getById } from './users.service.js';
import { serializeOpportunityTimes } from '../utils/time.js';
import type { Database } from '../types/supabase.generated.js';

type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];
type OpportunityHealthRow = Database['public']['Tables']['opportunity_health']['Row'];

export interface OpportunityCard extends OpportunityRow {
  match_score?: number;
  ai_reason?: string;
  attendee_count?: number;
  names_visible?: string[];
  distance_km?: number | null;
}

export interface OpportunityHealthCard extends OpportunityHealthRow {
  match_score?: number;
  distance_km?: number | null;
}

export interface FeedResponse {
  today_tomorrow: OpportunityCard[];
  this_week: OpportunityCard[];
  try_new: OpportunityCard[];
}

export type FeedFilter = 'health' | 'discounts';

export type FeedItem =
  | ({ source: 'opportunity' } & OpportunityCard)
  | ({ source: 'opportunity_health' } & OpportunityHealthCard);

export interface FilteredFeedResponse {
  filter: FeedFilter;
  items: FeedItem[];
}

const TODAY_TOMORROW_HOURS = 36;
const THIS_WEEK_HOURS = 168;
const TODAY_TOMORROW_LIMIT = 10;
const THIS_WEEK_LIMIT = 10;
const TRY_NEW_LIMIT = 2;
// Overfetch for try_new — we filter out interest-overlap candidates in JS,
// and a user whose interests align with a busy tag (e.g. 'sport' covers ~32
// opportunities here) can saturate the head of the pool. Sized so we still
// surface non-overlap candidates after a long overlap prefix.
const TRY_NEW_OVERFETCH = 50;
const NAMES_VISIBLE_MAX = 6;

interface MatchRow {
  event_id: string;
  score: number;
  opportunities: OpportunityRow | null;
}

// Three buckets, three parallel queries. Replaces a single
// "top 30 by score then bucket in JS" pass. The single-query variant let
// strong-match users in one tier crowd out the time-urgent buckets — e.g. a
// user whose only bonus interest matched a large service cluster had every
// slot filled by undated services and saw nothing in today/this_week.
export async function buildFeed(userId: string, cityFilter?: string): Promise<FeedResponse> {
  const user = await getById(userId);
  if (!user) throw AppError.notFound('User profile not found', 'user_not_found');

  const effectiveCity = cityFilter ?? user.city ?? null;

  const now = new Date();
  const wallNow = toWallClockUtc(now);
  const wallTodayTomorrowEnd = toWallClockUtc(
    new Date(now.getTime() + TODAY_TOMORROW_HOURS * 3600 * 1000),
  );
  const wallThisWeekEnd = toWallClockUtc(new Date(now.getTime() + THIS_WEEK_HOURS * 3600 * 1000));

  // Each bucket starts from the same base shape and differs only in the
  // start_at filter and limit. Defining baseQuery as a thunk so each call gets
  // a fresh chainable builder.
  const baseQuery = () => {
    let q = supabaseAdmin
      .from('event_matches')
      .select('event_id, score, opportunities!inner(*)')
      .eq('user_id', userId)
      .gt('score', 0);
    if (effectiveCity) q = q.eq('opportunities.city', effectiveCity);
    return q;
  };

  const [todayTomorrowResp, thisWeekResp, laterResp] = await Promise.all([
    baseQuery()
      .gte('opportunities.start_at', wallNow)
      .lt('opportunities.start_at', wallTodayTomorrowEnd)
      .order('score', { ascending: false })
      .order('event_id', { ascending: true })
      .limit(TODAY_TOMORROW_LIMIT),
    baseQuery()
      .gte('opportunities.start_at', wallTodayTomorrowEnd)
      .lt('opportunities.start_at', wallThisWeekEnd)
      .order('score', { ascending: false })
      .order('event_id', { ascending: true })
      .limit(THIS_WEEK_LIMIT),
    // "later" pool feeds try_new. Includes both far-future events and undated
    // services (start_at is null). Filter foreign-table column via .or() —
    // PostgREST passes the expression through to the joined opportunities row.
    baseQuery()
      .or(`start_at.is.null,start_at.gte.${wallThisWeekEnd}`, {
        foreignTable: 'opportunities',
      })
      .order('score', { ascending: false })
      .order('event_id', { ascending: true })
      .limit(TRY_NEW_OVERFETCH),
  ]);

  if (todayTomorrowResp.error)
    throw AppError.upstream('Failed to load today_tomorrow feed', todayTomorrowResp.error.message);
  if (thisWeekResp.error)
    throw AppError.upstream('Failed to load this_week feed', thisWeekResp.error.message);
  if (laterResp.error)
    throw AppError.upstream('Failed to load later feed pool', laterResp.error.message);

  const todayTomorrowRows = (todayTomorrowResp.data ?? []) as unknown as MatchRow[];
  const thisWeekRows = (thisWeekResp.data ?? []) as unknown as MatchRow[];
  const laterRows = (laterResp.data ?? []) as unknown as MatchRow[];

  const todayTomorrow = todayTomorrowRows
    .map((r) => r.opportunities)
    .filter((o): o is OpportunityRow => o !== null);
  const thisWeek = thisWeekRows
    .map((r) => r.opportunities)
    .filter((o): o is OpportunityRow => o !== null);

  // try_new: from the "later" pool, keep only those whose interests don't
  // overlap the user's, top TRY_NEW_LIMIT by the order already imposed by SQL.
  const userInterests = new Set(user.interests ?? []);
  const tryNew = laterRows
    .map((r) => r.opportunities)
    .filter((o): o is OpportunityRow => o !== null)
    .filter((o) => !o.interests.some((i) => userInterests.has(i)))
    .slice(0, TRY_NEW_LIMIT);

  // Decorate every opportunity we'll return. matchRows must include all three
  // buckets so match_score lookup hits for any visible card.
  const visible = [...todayTomorrow, ...thisWeek, ...tryNew];
  const allMatchRows = [...todayTomorrowRows, ...thisWeekRows, ...laterRows];
  const decorations = await decorate(visible, allMatchRows, user);

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

// opportunities.start_at is timestamp without tz, written as wall-clock UTC.
// Format a JS Date into the same shape so PostgREST `gte`/`lt`/`or` filters
// compare apples-to-apples. Output: "YYYY-MM-DDTHH:mm:ss" (no offset, no Z).
function toWallClockUtc(d: Date): string {
  return d.toISOString().slice(0, 19);
}

// ---------------------------------------------------------------------------
// Filtered feed: GET /feed?filter=health|discounts
// ---------------------------------------------------------------------------
//
// Returns a flat list (no time buckets) sourced from BOTH `opportunities` and
// `opportunity_health`, scoped to rows whose classified_interest overlaps a
// fixed tag set:
//   • health    → HEALTH_INTEREST_TAGS  (rehab, recovery, psych, medical, art/equine therapy)
//   • discounts → DISCOUNT_INTEREST_TAGS (discount_promotions)
//
// Per-row match_score is the count of overlapping classified_interest tags
// between the user and the row — same scoring shape as compute_match_score's
// classified-interest path, computed inline here because opportunity_health
// rows are not in event_matches and have no precomputed score.
//
// Past events (start_at < now) are excluded from the opportunities side.
// opportunity_health rows have no schedule, so they always pass.
//
// Ordering: match_score desc, then start_at asc / title asc as a stable
// tiebreaker. Cap of FILTERED_LIMIT items total after the merge.

const FILTERED_LIMIT = 30;
const FILTERED_PER_TABLE_OVERFETCH = 60;

const FILTER_TAG_SETS: Record<FeedFilter, readonly ClassifiedInterest[]> = {
  health: HEALTH_INTEREST_TAGS,
  discounts: DISCOUNT_INTEREST_TAGS,
};

export async function buildFilteredFeed(
  userId: string,
  filter: FeedFilter,
  cityFilter?: string,
): Promise<FilteredFeedResponse> {
  const user = await getById(userId);
  if (!user) throw AppError.notFound('User profile not found', 'user_not_found');

  const effectiveCity = cityFilter ?? user.city ?? null;
  const tagSet = FILTER_TAG_SETS[filter];
  // PostgREST array-overlap filter syntax: `ov.{a,b,c}` (not quoted)
  const tagOverlapExpr = `{${tagSet.join(',')}}`;

  const userInterestsSet = new Set<string>(user.classified_interest ?? []);

  // Pull opportunities + opportunity_health in parallel. Each table is
  // overfetched and merged below so a popular tag on one side doesn't
  // crowd out the other.
  const wallNow = toWallClockUtc(new Date());

  const oppQuery = supabaseAdmin
    .from('opportunities')
    .select('*')
    .overlaps('classified_interest', tagSet as unknown as string[])
    // Drop past events. Undated events (start_at IS NULL) always pass —
    // they're "always-on" entries living in the events table.
    .or(`start_at.is.null,start_at.gte.${wallNow}`)
    .order('start_at', { ascending: true, nullsFirst: false })
    .limit(FILTERED_PER_TABLE_OVERFETCH);
  const oppQueryFinal = effectiveCity ? oppQuery.eq('city', effectiveCity) : oppQuery;

  const healthQuery = supabaseAdmin
    .from('opportunity_health')
    .select('*')
    .overlaps('classified_interest', tagSet as unknown as string[])
    .order('title', { ascending: true })
    .limit(FILTERED_PER_TABLE_OVERFETCH);
  const healthQueryFinal = effectiveCity ? healthQuery.eq('city', effectiveCity) : healthQuery;

  const [oppResp, healthResp] = await Promise.all([oppQueryFinal, healthQueryFinal]);

  if (oppResp.error)
    throw AppError.upstream('Failed to load filtered opportunities', oppResp.error.message);
  if (healthResp.error)
    throw AppError.upstream('Failed to load filtered opportunity_health', healthResp.error.message);

  const oppRows = (oppResp.data ?? []) as OpportunityRow[];
  const healthRows = (healthResp.data ?? []) as OpportunityHealthRow[];

  // Decorate opportunities with attendee counts (same logic as default feed
  // decorate(), trimmed). Skipped for opportunity_health because it has
  // visit_count built in.
  const oppDecorations = await decorateOpportunities(oppRows);

  const oppItems: FeedItem[] = oppRows.map((o) => {
    const dec = oppDecorations.get(o.id);
    return {
      source: 'opportunity' as const,
      ...serializeOpportunityTimes(o),
      match_score: countOverlap(userInterestsSet, o.classified_interest),
      attendee_count: dec?.attendee_count ?? 0,
      names_visible: dec?.names_visible ?? [],
      distance_km: null,
    };
  });

  const healthItems: FeedItem[] = healthRows.map((h) => ({
    source: 'opportunity_health' as const,
    ...h,
    match_score: countOverlap(userInterestsSet, h.classified_interest),
    distance_km: null,
  }));

  // Merge, sort by match_score desc + stable tiebreaker (table-side ORDER BY
  // already gave each list a sensible secondary ordering), cap.
  const merged: FeedItem[] = [...oppItems, ...healthItems];
  merged.sort((a, b) => (b.match_score ?? 0) - (a.match_score ?? 0));
  return { filter, items: merged.slice(0, FILTERED_LIMIT) };
}

function countOverlap(
  userTags: Set<string>,
  rowTags: ClassifiedInterest[] | string[] | null,
): number {
  if (!rowTags || rowTags.length === 0) return 0;
  let n = 0;
  for (const t of rowTags) if (userTags.has(t)) n += 1;
  return n;
}

// Slimmer decorate() variant: only attendee_count + names_visible. The full
// decorate() in buildFeed also threads match_score through matchRows, but
// the filtered feed computes match_score inline (we don't have event_matches
// for opportunity_health), so that join is unnecessary here.
async function decorateOpportunities(
  opportunities: OpportunityRow[],
): Promise<Map<string, { attendee_count: number; names_visible: string[] }>> {
  const out = new Map<string, { attendee_count: number; names_visible: string[] }>();
  if (opportunities.length === 0) return out;
  const ids = opportunities.map((o) => o.id);

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

  for (const o of opportunities) {
    out.set(o.id, {
      attendee_count: counts.get(o.id) ?? 0,
      names_visible: names.get(o.id) ?? [],
    });
  }
  return out;
}
