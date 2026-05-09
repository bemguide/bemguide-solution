import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import { encodeCursor, decodeCursor, clampLimit } from '../utils/cursor.js';
import type { Database } from '../types/supabase.generated.js';

export type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];
export type OpportunityInsert = Database['public']['Tables']['opportunities']['Insert'];
export type OpportunityUpdate = Database['public']['Tables']['opportunities']['Update'];

export async function create(input: OpportunityInsert): Promise<OpportunityRow> {
  // ends_at is a generated column — never write it. The validation layer accepts
  // start_at as ISO datetime then strips the offset to a wall-clock string;
  // this matches the timestamp(no tz) column type per SCHEMA.md "Timestamps".
  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .insert(input)
    .select('*')
    .single();

  if (error || !data) throw AppError.upstream('Failed to create opportunity', error?.message);
  return data;
}

export async function update(id: string, patch: OpportunityUpdate): Promise<OpportunityRow> {
  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw AppError.upstream('Failed to update opportunity', error.message);
  if (!data) throw AppError.notFound('Opportunity not found');
  return data;
}

export async function archive(id: string): Promise<void> {
  // Hard delete. CASCADE FKs on event_matches/event_invitations/event_attendees/
  // event_rooms clean up downstream rows automatically.
  const { error } = await supabaseAdmin.from('opportunities').delete().eq('id', id);
  if (error) throw AppError.upstream('Failed to archive opportunity', error.message);
}

export async function getById(id: string): Promise<OpportunityRow | null> {
  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw AppError.upstream('Failed to load opportunity', error.message);
  return data;
}

// Cheap decorations for GET /opportunities/:id (and any other "single
// opportunity card" surface that doesn't go through /feed).
export interface SingleOpportunityDecoration {
  match_score?: number;
  attendee_count: number;
  names_visible: string[];
}

const NAMES_VISIBLE_MAX = 6;

export async function decorateForCard(
  opportunityId: string,
  userId: string | null,
): Promise<SingleOpportunityDecoration> {
  // Match score is per-(user,event), only meaningful when authed.
  let match_score: number | undefined;
  if (userId) {
    const { data: matchRow, error: matchErr } = await supabaseAdmin
      .from('event_matches')
      .select('score')
      .eq('event_id', opportunityId)
      .eq('user_id', userId)
      .maybeSingle();
    if (matchErr) throw AppError.upstream('Failed to load match score', matchErr.message);
    match_score = matchRow?.score;
  }

  const { data: attendeesData, error: attendeesErr } = await supabaseAdmin
    .from('event_attendees')
    .select('show_name_publicly, users:user_id(display_name, show_name_publicly)')
    .eq('event_id', opportunityId)
    .in('status', ['joining', 'attended']);
  if (attendeesErr) {
    throw AppError.upstream('Failed to load attendee decoration', attendeesErr.message);
  }

  type AttendeeRow = {
    show_name_publicly: boolean;
    users: { display_name: string | null; show_name_publicly: boolean } | null;
  };
  const rows = (attendeesData ?? []) as unknown as AttendeeRow[];

  const names: string[] = [];
  for (const row of rows) {
    if (names.length >= NAMES_VISIBLE_MAX) break;
    if (row.show_name_publicly && row.users?.show_name_publicly && row.users.display_name) {
      names.push(row.users.display_name);
    }
  }

  return {
    match_score,
    attendee_count: rows.length,
    names_visible: names,
  };
}

export interface ListOpportunitiesOpts {
  city?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export interface OpportunityPage {
  items: OpportunityRow[];
  next_cursor: string | null;
}

export async function listForCity(opts: ListOpportunitiesOpts): Promise<OpportunityPage> {
  const limit = clampLimit(opts.limit);

  let query = supabaseAdmin
    .from('opportunities')
    .select('*')
    .order('start_at', { ascending: true, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit + 1);

  if (opts.city) query = query.eq('city', opts.city);
  if (opts.from) query = query.gte('start_at', stripTz(opts.from));
  if (opts.to) query = query.lte('start_at', stripTz(opts.to));

  if (opts.cursor) {
    const decoded = decodeCursor<{ ts: string; id: string }>(opts.cursor);
    if (decoded) {
      // Forward keyset on (start_at asc, id asc).
      query = query.or(
        `start_at.gt.${decoded.ts},and(start_at.eq.${decoded.ts},id.gt.${decoded.id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw AppError.upstream('Failed to list opportunities', error.message);
  const rows = data ?? [];

  let next_cursor: string | null = null;
  let items = rows;
  if (rows.length > limit) {
    items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    if (last.start_at) {
      next_cursor = encodeCursor({ ts: last.start_at, id: last.id });
    }
  }
  return { items, next_cursor };
}

// opportunities.start_at is `timestamp` (no tz). Inputs come in as ISO with
// 'Z' or +HH:MM; lop the suffix so PostgREST sends the literal wall-clock.
function stripTz(iso: string): string {
  return iso.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
}
