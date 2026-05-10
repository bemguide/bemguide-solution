// One-off CLI: backfill classified_interest across opportunities,
// opportunity_health, and users.
//
// Usage: npx tsx scripts/backfill-classifier.ts [--limit=N] [--table=opportunities|opportunity_health|users]
//
// What it does:
//   1. Selects rows where classified_at IS NULL.
//   2. Calls gemini.service.classifyInterest() per row, concurrency 4.
//   3. Writes back classified_interest, classified_at, classifier_version,
//      classifier_confidence.
//
// Idempotent. Re-runnable: rows with classified_at already set are skipped.
// To force a re-run after a prompt/version bump:
//   UPDATE <table> SET classified_at = NULL WHERE classifier_version != 'v2';
//
// Per-row failure (Gemini outage, schema parse fail) leaves classified_at
// NULL so the next run picks it up. Never crashes the whole backfill.

import { supabaseAdmin } from '../src/config/supabase.js';
import {
  classifyInterest,
  CLASSIFIER_VERSION,
  type ClassifiedInterest,
  type ClassifyEntityType,
} from '../src/services/gemini.service.js';

interface OppLikeRow {
  id: string;
  title: string | null;
  short_description: string | null;
  description: string | null;
  interests: string[] | null;
}

interface UserRow {
  id: string;
  display_name: string | null;
  bio: string | null;
  interests: string[] | null;
}

interface BackfillSummary {
  table: string;
  total: number;
  classified: number;
  failed: number;
}

const CONCURRENCY = 4;

async function loadOppLike(table: 'opportunities' | 'opportunity_health'): Promise<OppLikeRow[]> {
  const { data, error } = await supabaseAdmin
    .from(table)
    .select('id, title, short_description, description, interests')
    .is('classified_at', null);
  if (error) throw new Error(`${table} load failed: ${error.message}`);
  // opportunity_health.interests is health_interest[] (a string-compatible enum
  // array at runtime); coerce to string[] for the classifier payload, which
  // accepts existing free-form tags as a hint.
  return (data ?? []).map((r) => ({
    id: r.id,
    title: r.title,
    short_description: r.short_description,
    description: r.description,
    interests: (r.interests ?? []) as unknown as string[],
  }));
}

async function loadUsers(): Promise<UserRow[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, display_name, bio, interests')
    .is('classified_at', null);
  if (error) throw new Error(`users load failed: ${error.message}`);
  return data ?? [];
}

async function writeClassification(
  table: 'opportunities' | 'opportunity_health' | 'users',
  id: string,
  tags: ClassifiedInterest[],
  confidence: number,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from(table)
    .update({
      classified_interest: tags,
      classified_at: new Date().toISOString(),
      classifier_version: CLASSIFIER_VERSION,
      classifier_confidence: confidence,
    })
    .eq('id', id);
  if (error) throw new Error(`${table} update failed (id=${id}): ${error.message}`);
}

async function processBatch<T extends { id: string }>(
  rows: T[],
  table: 'opportunities' | 'opportunity_health' | 'users',
  entityType: ClassifyEntityType,
  buildPayload: (row: T) => Parameters<typeof classifyInterest>[1],
): Promise<BackfillSummary> {
  const summary: BackfillSummary = { table, total: rows.length, classified: 0, failed: 0 };
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < rows.length) {
      const i = cursor++;
      const row = rows[i];
      try {
        const result = await classifyInterest(entityType, buildPayload(row));
        if (!result) {
          summary.failed += 1;
          process.stdout.write(`  [${table}] ${row.id} → fallback (left NULL)\n`);
          continue;
        }
        await writeClassification(table, row.id, result.classified_interest, result.confidence);
        summary.classified += 1;
        process.stdout.write(
          `  [${table}] ${row.id} → ${result.classified_interest.join(',')} (conf ${result.confidence.toFixed(2)})\n`,
        );
      } catch (err) {
        summary.failed += 1;
        const reason = err instanceof Error ? err.message : 'unknown';
        process.stderr.write(`  [${table}] ${row.id} → ERROR: ${reason}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
  return summary;
}

function parseArgs(): { limit: number | null; only: string | null } {
  const args = process.argv.slice(2);
  let limit: number | null = null;
  let only: string | null = null;
  for (const a of args) {
    if (a.startsWith('--limit=')) limit = Number(a.slice('--limit='.length)) || null;
    else if (a.startsWith('--table=')) only = a.slice('--table='.length);
  }
  return { limit, only };
}

async function main(): Promise<void> {
  const { limit, only } = parseArgs();
  const summaries: BackfillSummary[] = [];

  if (!only || only === 'opportunities') {
    let rows = await loadOppLike('opportunities');
    if (limit) rows = rows.slice(0, limit);
    console.log(`opportunities: ${rows.length} rows to classify`);
    summaries.push(
      await processBatch(rows, 'opportunities', 'opportunity', (r) => ({
        title: r.title,
        short_description: r.short_description,
        description: r.description,
        interests: r.interests,
      })),
    );
  }

  if (!only || only === 'opportunity_health') {
    let rows = await loadOppLike('opportunity_health');
    if (limit) rows = rows.slice(0, limit);
    console.log(`opportunity_health: ${rows.length} rows to classify`);
    summaries.push(
      await processBatch(rows, 'opportunity_health', 'opportunity_health', (r) => ({
        title: r.title,
        short_description: r.short_description,
        description: r.description,
        interests: r.interests,
      })),
    );
  }

  if (!only || only === 'users') {
    let rows = await loadUsers();
    if (limit) rows = rows.slice(0, limit);
    console.log(`users: ${rows.length} rows to classify`);
    summaries.push(
      await processBatch(rows, 'users', 'user', (r) => ({
        display_name: r.display_name,
        bio: r.bio,
        interests: r.interests,
      })),
    );
  }

  console.log('\n=== Summary ===');
  for (const s of summaries) {
    console.log(
      `  ${s.table}: classified=${s.classified} failed=${s.failed} (of ${s.total} pending)`,
    );
  }
  const totalFailed = summaries.reduce((acc, s) => acc + s.failed, 0);
  // Failed rows leave classified_at NULL, so the script can be re-run safely
  // (or the hourly catch-up cron will pick them up). Don't exit non-zero on
  // partial failure — only on hard load errors.
  if (totalFailed > 0) {
    console.log(`\n${totalFailed} rows failed; re-run to retry.`);
  }
}

main().catch((err) => {
  console.error('backfill-classifier crashed:', err);
  process.exit(1);
});
