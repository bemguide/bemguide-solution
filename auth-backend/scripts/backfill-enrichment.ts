// One-off CLI: backfill missing `address` and `photo_url` on opportunities
// and opportunity_health using existing lat/lng + title/city as inputs.
//
// Usage: npx tsx scripts/backfill-enrichment.ts [--limit=N] [--table=opportunities|opportunity_health]
//
// What it does:
//   1. Selects rows where address IS NULL OR photo_url IS NULL.
//   2. Reverse-geocodes existing (lat,lng) via Nominatim → address.
//   3. Searches Openverse with `title city` → photo_url.
//   4. Writes back whichever columns it managed to fill.
//
// Idempotent. Re-runnable: rows whose values are already populated are
// skipped. Per-row failures (network blip, zero results, geocoder error)
// leave the column NULL so the next run picks it up. Never crashes the
// whole backfill on a single bad row.
//
// Throughput is gated by Nominatim's 1 req/s policy (~1.1s/row when
// address is missing). At ~250 rows total expect ~5 minutes wall-clock.

import { supabaseAdmin } from '../src/config/supabase.js';
import { reverseGeocode } from '../src/services/nominatim.service.js';
import { searchTopImage } from '../src/services/openverse.service.js';

type Table = 'opportunities' | 'opportunity_health';

interface Row {
  id: string;
  title: string;
  city: string;
  address: string | null;
  photo_url: string | null;
  location_lat: number;
  location_lng: number;
  classified_interest: string[] | null;
}

// Maps each classified_interest enum value to a short English keyword that
// Openverse's stock-photo index actually matches. Using row titles directly
// (Ukrainian program names) returns zero hits — they're not landmarks. Using
// the classifier's controlled vocabulary gives near-100% hit rate at the
// cost of *thematic* photos rather than venue-specific ones.
const INTEREST_KEYWORD: Record<string, string> = {
  rehabilitation: 'rehabilitation therapy',
  physical_sport: 'sport athlete',
  discount_promotions: 'shopping store',
  education: 'classroom education',
  psychological_support: 'therapy counseling',
  family_support: 'family',
  adaptive_sport: 'wheelchair sport',
  career_development: 'career business',
  financial_aid: 'money finance',
  community_meetup: 'people meeting',
  medical_care: 'medical doctor',
  creative_workshop: 'art workshop',
  legal_aid: 'law book',
  recovery: 'wellness recovery',
  employment: 'office work',
  support_group: 'support group',
  art_therapy: 'art therapy painting',
  cultural_event: 'concert event',
  outdoor_recreation: 'hiking nature',
  music: 'music concert',
  equine_therapy: 'horse riding',
  women_support: 'women community',
  veteran_services: 'veteran soldier',
};

const FALLBACK_QUERY = 'Ukraine veteran';

function buildPhotoQueries(row: Row): string[] {
  const queries: string[] = [];
  const tags = row.classified_interest ?? [];
  for (const tag of tags) {
    const kw = INTEREST_KEYWORD[tag];
    if (kw && !queries.includes(kw)) queries.push(kw);
    if (queries.length >= 2) break;
  }
  queries.push(FALLBACK_QUERY);
  return queries;
}

interface Summary {
  table: Table;
  scanned: number;
  addressesFilled: number;
  addressesFailed: number;
  photosFilled: number;
  photosFailed: number;
}

async function loadRows(table: Table, limit: number | null): Promise<Row[]> {
  let query = supabaseAdmin
    .from(table)
    .select('id, title, city, address, photo_url, location_lat, location_lng, classified_interest')
    .or('address.is.null,photo_url.is.null');
  if (limit !== null) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`${table} load failed: ${error.message}`);
  return (data ?? []) as unknown as Row[];
}

async function processRow(table: Table, row: Row, summary: Summary): Promise<void> {
  const update: { address?: string; photo_url?: string } = {};
  let addrTag: 'ok' | 'skip' | 'fail' = row.address ? 'skip' : 'fail';
  let photoTag: 'ok' | 'skip' | 'fail' = row.photo_url ? 'skip' : 'fail';

  if (!row.address) {
    try {
      const addr = await reverseGeocode(Number(row.location_lat), Number(row.location_lng));
      if (addr) {
        update.address = addr;
        summary.addressesFilled += 1;
        addrTag = 'ok';
      } else {
        summary.addressesFailed += 1;
      }
    } catch (err) {
      summary.addressesFailed += 1;
      const reason = err instanceof Error ? err.message : 'unknown';
      process.stderr.write(`  [${table}] ${row.id} addr ERROR: ${reason}\n`);
    }
  }

  if (!row.photo_url) {
    const queries = buildPhotoQueries(row);
    let foundUrl: string | null = null;
    let lastError: string | null = null;
    for (const q of queries) {
      try {
        const url = await searchTopImage(q);
        if (url) {
          foundUrl = url;
          break;
        }
      } catch (err) {
        lastError = err instanceof Error ? err.message : 'unknown';
      }
    }
    if (foundUrl) {
      update.photo_url = foundUrl;
      summary.photosFilled += 1;
      photoTag = 'ok';
    } else {
      summary.photosFailed += 1;
      if (lastError) {
        process.stderr.write(`  [${table}] ${row.id} photo ERROR: ${lastError}\n`);
      }
    }
  }

  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin.from(table).update(update).eq('id', row.id);
    if (error) {
      process.stderr.write(`  [${table}] ${row.id} update FAIL: ${error.message}\n`);
      return;
    }
  }

  process.stdout.write(`  [${table}] ${row.id} addr=${addrTag} photo=${photoTag}\n`);
}

async function processTable(table: Table, limit: number | null): Promise<Summary> {
  const rows = await loadRows(table, limit);
  console.log(`${table}: ${rows.length} rows pending`);
  const summary: Summary = {
    table,
    scanned: rows.length,
    addressesFilled: 0,
    addressesFailed: 0,
    photosFilled: 0,
    photosFailed: 0,
  };
  // Sequential by design: Nominatim's 1 rps cap means concurrency > 1 wastes
  // wall time waiting on the rate gate, and the script is bounded (~250 rows).
  for (const row of rows) {
    await processRow(table, row, summary);
  }
  return summary;
}

function parseArgs(): { limit: number | null; only: Table | null } {
  let limit: number | null = null;
  let only: Table | null = null;
  for (const a of process.argv.slice(2)) {
    if (a.startsWith('--limit=')) {
      const n = Number(a.slice('--limit='.length));
      if (Number.isFinite(n) && n > 0) limit = n;
    } else if (a.startsWith('--table=')) {
      const t = a.slice('--table='.length);
      if (t === 'opportunities' || t === 'opportunity_health') only = t;
    }
  }
  return { limit, only };
}

async function main(): Promise<void> {
  const { limit, only } = parseArgs();
  const summaries: Summary[] = [];

  if (!only || only === 'opportunities') {
    summaries.push(await processTable('opportunities', limit));
  }
  if (!only || only === 'opportunity_health') {
    summaries.push(await processTable('opportunity_health', limit));
  }

  console.log('\n=== Summary ===');
  for (const s of summaries) {
    const addrTotal = s.addressesFilled + s.addressesFailed;
    const photoTotal = s.photosFilled + s.photosFailed;
    console.log(
      `  ${s.table}: addresses=${s.addressesFilled}/${addrTotal} ` +
        `photos=${s.photosFilled}/${photoTotal} (of ${s.scanned} scanned)`,
    );
  }
  const totalFailed = summaries.reduce((acc, s) => acc + s.addressesFailed + s.photosFailed, 0);
  if (totalFailed > 0) {
    console.log(`\n${totalFailed} field(s) failed; re-run to retry (NULLs are picked up again).`);
  }
}

main().catch((err) => {
  console.error('backfill-enrichment crashed:', err);
  process.exit(1);
});
