import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import { clampLimit, decodeCursor, encodeCursor } from '../utils/cursor.js';
import type { Database } from '../types/supabase.generated.js';

type MatchRow = Database['public']['Tables']['event_matches']['Row'];
type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];

// Joined shape returned by select('*, opportunities(*)') — useful for clients
// that want the event details alongside the score.
export interface MatchWithOpportunity extends MatchRow {
  opportunities: OpportunityRow | null;
}

export interface MatchesPage {
  items: MatchWithOpportunity[];
  next_cursor: string | null;
}

interface ScoreCursor {
  score: number;
  event_id: string;
}

// Service-role read with explicit user_id filter — replaces the user-token +
// RLS event_matches_self_read path (HS256 session JWTs aren't
// PostgREST-verifiable). Sort: score desc, event_id desc (deterministic tiebreak).
export async function listForUser(
  userId: string,
  opts: { limit?: number; cursor?: string },
): Promise<MatchesPage> {
  const limit = clampLimit(opts.limit);

  let query = supabaseAdmin
    .from('event_matches')
    .select('*, opportunities(*)')
    .eq('user_id', userId)
    .order('score', { ascending: false })
    .order('event_id', { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    const decoded = decodeCursor<ScoreCursor>(opts.cursor);
    if (decoded) {
      // Forward keyset on (score desc, event_id desc):
      // (score < cursor.score) OR (score = cursor.score AND event_id < cursor.event_id)
      query = query.or(
        `score.lt.${decoded.score},and(score.eq.${decoded.score},event_id.lt.${decoded.event_id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw AppError.upstream('Failed to load matches', error.message);
  const rows = (data ?? []) as MatchWithOpportunity[];

  let next_cursor: string | null = null;
  let items = rows;
  if (rows.length > limit) {
    items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    next_cursor = encodeCursor<ScoreCursor>({ score: last.score, event_id: last.event_id });
  }
  return { items, next_cursor };
}
