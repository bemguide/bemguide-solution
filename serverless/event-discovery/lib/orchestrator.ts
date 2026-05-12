import { discoverCandidates } from "./tavily.js";
import { classifyAll, isKept } from "./classify.js";
import { filterByRegion } from "./filter-region.js";
import { buildOpportunities } from "./map-event.js";
import { fetchRecentPostUrls, insertOpportunities } from "./supabase.js";
import { getRegion } from "./regions.js";
import type { SyncStats } from "./types.js";

export async function runDailySync(): Promise<SyncStats> {
  const t0 = Date.now();
  const regionId = process.env.REGION_ID ?? "dnipro";
  const region = getRegion(regionId);

  const stats: SyncStats = {
    region_id: regionId,
    time_range: process.env.TIME_RANGE ?? "day",
    candidates_searched: 0,
    candidates_unique: 0,
    classified: 0,
    classified_kept: 0,
    in_dnipro: 0,
    mapped: 0,
    deduplicated: 0,
    inserted: 0,
    failed: 0,
    duration_sec: 0,
  };

  console.log(`[sync] region=${regionId} time_range=${stats.time_range}`);

  // 1. Discovery
  const candidates = await discoverCandidates(region);
  stats.candidates_searched = candidates.length;
  stats.candidates_unique = candidates.length; // already deduped by url inside discoverCandidates
  console.log(`[sync] discovered ${candidates.length} candidates`);

  // 2. Classify
  const classified = await classifyAll(candidates);
  const kept = classified.filter(isKept);
  stats.classified = classified.length;
  stats.classified_kept = kept.length;
  console.log(`[sync] classified=${classified.length}, kept=${kept.length}`);

  // 3. Region filter
  const inRegion = await filterByRegion(kept, region);
  stats.in_dnipro = inRegion.length;
  console.log(`[sync] in-region=${inRegion.length}`);

  // 4. Dedup against existing Supabase rows (by post_url embedded in organizer_contact)
  const existingUrls = await fetchRecentPostUrls();
  const fresh = inRegion.filter((e) => !existingUrls.has(e.post_url));
  stats.deduplicated = inRegion.length - fresh.length;
  console.log(`[sync] fresh=${fresh.length} (deduped ${stats.deduplicated} already-imported)`);

  // 5. Map → opportunities
  const built = await buildOpportunities(fresh);
  stats.mapped = built.length;
  console.log(`[sync] mapped=${built.length}`);

  // 6. Insert
  const result = await insertOpportunities(built.map((b) => b.opp));
  stats.inserted = result.inserted;
  stats.failed = result.failed;
  console.log(`[sync] inserted=${result.inserted} failed=${result.failed}`);

  stats.duration_sec = Math.round((Date.now() - t0) / 1000);
  return stats;
}
