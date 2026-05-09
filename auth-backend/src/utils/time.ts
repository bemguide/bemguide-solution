import type { Database } from '../types/supabase.generated.js';

type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];

// opportunities.start_at and opportunities.ends_at are `timestamp` (no tz) in
// the DB — generated `ends_at` requires an IMMUTABLE expression and
// `timestamptz + interval` is STABLE, so the column intentionally has no tz.
//
// SCHEMA.md says the app layer normalises tz on read/write. Per the v2
// frontend contract: serialize as ISO with explicit `+03:00` (Europe/Kyiv,
// no DST in Ukraine since 2024). Frontend treats whatever we return as
// canonical wire-time and re-renders in Europe/Kyiv.

const KYIV_OFFSET = '+03:00';

export function attachKyivOffset(wallClock: string | null): string | null {
  if (!wallClock) return wallClock;
  // Strip any existing offset / Z (DB shouldn't return one, but guard) then append.
  const stripped = wallClock.replace(/Z$|[+-]\d{2}:?\d{2}$/, '');
  return `${stripped}${KYIV_OFFSET}`;
}

// Apply attachKyivOffset to every wall-clock field on an opportunity row before
// returning it to the client.
export function serializeOpportunityTimes<T extends OpportunityRow>(o: T): T {
  return {
    ...o,
    start_at: attachKyivOffset(o.start_at),
    ends_at: attachKyivOffset(o.ends_at),
  };
}
