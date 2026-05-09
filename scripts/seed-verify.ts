// One-off check that the M3 seed produced what we expected.
// Run: pnpm exec tsx --env-file=.env.local scripts/seed-verify.ts

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function main() {
  const { data: events, error: eErr } = await supabase
    .from("events")
    .select("id, slug, title, city, identity_tag, accessibility_flags, start_at")
    .eq("source", "admin_seed")
    .order("start_at", { ascending: true })
    .limit(3);
  if (eErr) throw eErr;
  console.log("First 3 upcoming seeded events:");
  for (const ev of events ?? []) {
    console.log(`  • ${ev.title} — ${ev.city} — ${ev.start_at}`);
  }

  const firstId = events?.[0]?.id;
  if (firstId) {
    const { data: count, error: cErr } = await supabase.rpc("public_rsvp_count", {
      p_event_id: firstId,
    });
    if (cErr) throw cErr;
    console.log(`\npublic_rsvp_count for ${events?.[0]?.slug}:`, JSON.stringify(count));
  }

  const { data: stats, error: sErr } = await supabase
    .from("events")
    .select("city, identity_tag, categories, accessibility_flags")
    .eq("source", "admin_seed");
  if (sErr) throw sErr;
  if (!stats) throw new Error("no stats");
  const byCity = new Map<string, number>();
  let womenOnly = 0,
    barrierFree = 0,
    movement = 0,
    craftOrCommunity = 0;
  for (const s of stats) {
    byCity.set(s.city, (byCity.get(s.city) ?? 0) + 1);
    if (s.identity_tag === "women_only") womenOnly++;
    if ((s.accessibility_flags ?? []).includes("barrier_free")) barrierFree++;
    if ((s.categories ?? []).includes("movement")) movement++;
    if ((s.categories ?? []).some((c: string) => c === "craft" || c === "community")) {
      craftOrCommunity++;
    }
  }
  console.log("\nDistribution:");
  console.log("  by city:", Object.fromEntries(byCity));
  console.log(`  women_only: ${womenOnly}  barrier_free: ${barrierFree}`);
  console.log(`  movement: ${movement}  craft|community: ${craftOrCommunity}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
