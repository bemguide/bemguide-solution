// Seed runner. Idempotent: clears prior seed rows (using stable markers) before inserting.
//
// Run with:  pnpm seed
// Requires:  SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env.local
//
// Strategy:
//   1. Clean prior seed rows in dependency order (markers: events.source='admin_seed',
//      organizations.notes='[seed]', veterans.comfort_notes='[seed-ghost]', ghost rsvps).
//   2. Upsert reference cities.
//   3. Insert organizations -> capture key->id map.
//   4. Insert events linked to organizations -> capture slug->id map.
//   5. Insert ghost veterans -> capture name->id map.
//   6. For each event, deterministic-shuffle the ghosts in matching city and create
//      ghost RSVPs (status='going', is_ghost=true, show_name_publicly=true).

import { createClient } from "@supabase/supabase-js";
import {
  SEED_CITIES,
  SEED_ORGS,
  SEED_GHOSTS,
  SEED_EVENTS,
  SEED_ORG_MARKER,
  SEED_GHOST_MARKER,
} from "./data";

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceKey) {
  console.error(
    "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Run with: pnpm seed (loads .env.local).",
  );
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

/**
 * Build an ISO timestamp at `today + days`, hour:minute, in Europe/Kyiv timezone.
 * Hardcoded +03:00 (EEST) — all seed events fall in May/June so this is correct;
 * if the seed is re-run in winter the displayed local time would be 1h off (acceptable for demo).
 */
function kyivISO(daysFromToday: number, hour: number, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(hour).padStart(2, "0");
  const min = String(minute).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00+03:00`;
}

/** Deterministic PRNG seeded by string (Mulberry32 over xfnv1a hash). */
function seededRng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let state = h ^ (h >>> 16);
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicShuffle<T>(arr: readonly T[], seed: string): T[] {
  const result = arr.slice();
  const rng = seededRng(seed);
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

function photoUrl(slug: string): string {
  return `https://picsum.photos/seed/${slug}/800/450`;
}

function organizerContactSnapshot(org: (typeof SEED_ORGS)[number]): string {
  return `${org.contact_telegram} • ${org.contact_phone}`;
}

// ----------------------------------------------------------------
// step 1 — clean
// ----------------------------------------------------------------

async function cleanSeed() {
  console.log("• Cleaning prior seed rows…");

  // 1a. ratings (depends on rsvps)
  // No marker; clean indirectly by removing ghost rsvps next, which cascades.
  // (ratings_rsvp_id_fkey on delete cascade.)

  // 1b. ghost rsvps
  const { error: rsvpsErr } = await supabase.from("rsvps").delete().eq("is_ghost", true);
  if (rsvpsErr) throw rsvpsErr;

  // 1c. seeded events. Cascades to remaining rsvps + notifications + shares + moderation_log.
  const { error: eventsErr } = await supabase.from("events").delete().eq("source", "admin_seed");
  if (eventsErr) throw eventsErr;

  // 1d. seeded organizations
  const { error: orgsErr } = await supabase
    .from("organizations")
    .delete()
    .eq("notes", SEED_ORG_MARKER);
  if (orgsErr) throw orgsErr;

  // 1e. ghost veterans
  const { error: vetsErr } = await supabase
    .from("veterans")
    .delete()
    .eq("comfort_notes", SEED_GHOST_MARKER);
  if (vetsErr) throw vetsErr;

  console.log("  ✓ Prior seed rows cleared.");
}

// ----------------------------------------------------------------
// step 2 — cities (upsert by slug)
// ----------------------------------------------------------------

async function seedCities() {
  console.log("• Upserting cities…");
  const { error } = await supabase.from("cities").upsert(SEED_CITIES, { onConflict: "slug" });
  if (error) throw error;
  console.log(`  ✓ ${SEED_CITIES.length} cities present.`);
}

// ----------------------------------------------------------------
// step 3 — organizations
// ----------------------------------------------------------------

async function seedOrganizations(): Promise<Map<string, string>> {
  console.log("• Inserting organizations…");
  const rows = SEED_ORGS.map((o) => ({
    name: o.name,
    contact_name: o.contact_name,
    contact_phone: o.contact_phone,
    contact_telegram: o.contact_telegram,
    type: o.type,
    city: o.city,
    oblast: o.oblast,
    verified: o.verified,
    notes: SEED_ORG_MARKER,
  }));
  const { data, error } = await supabase.from("organizations").insert(rows).select("id, name");
  if (error) throw error;

  const map = new Map<string, string>();
  for (const seed of SEED_ORGS) {
    const found = data?.find((d) => d.name === seed.name);
    if (!found) throw new Error(`Could not locate inserted organization: ${seed.name}`);
    map.set(seed.key, found.id);
  }
  console.log(`  ✓ ${map.size} organizations inserted.`);
  return map;
}

// ----------------------------------------------------------------
// step 4 — events
// ----------------------------------------------------------------

async function seedEvents(orgIds: Map<string, string>): Promise<Map<string, string>> {
  console.log("• Inserting events…");
  const orgSnapshotByKey = new Map<string, string>();
  for (const o of SEED_ORGS) orgSnapshotByKey.set(o.key, organizerContactSnapshot(o));

  const rows = SEED_EVENTS.map((e) => {
    const organizerId = orgIds.get(e.organizer_key);
    if (!organizerId) {
      throw new Error(`Event ${e.slug} references unknown organizer key ${e.organizer_key}`);
    }
    return {
      slug: e.slug,
      title: e.title,
      short_description: e.short_description,
      description: e.description,
      organizer_id: organizerId,
      city: e.city,
      oblast: e.oblast,
      address: e.address,
      location_lat: e.location_lat,
      location_lng: e.location_lng,
      start_at: kyivISO(e.days_from_today, e.hour, e.minute),
      duration_min: e.duration_min,
      categories: e.categories,
      identity_tag: e.identity_tag,
      accessibility_flags: e.accessibility_flags,
      honest_absences: e.honest_absences,
      price_uah: e.price_uah,
      photo_url: photoUrl(e.slug),
      organizer_contact: orgSnapshotByKey.get(e.organizer_key),
      source: "admin_seed" as const,
      status: "approved" as const,
      published_at: new Date().toISOString(),
    };
  });

  const { data, error } = await supabase.from("events").insert(rows).select("id, slug");
  if (error) throw error;

  const map = new Map<string, string>();
  for (const ev of SEED_EVENTS) {
    const found = data?.find((d) => d.slug === ev.slug);
    if (!found) throw new Error(`Could not locate inserted event: ${ev.slug}`);
    map.set(ev.slug, found.id);
  }
  console.log(`  ✓ ${map.size} events inserted.`);
  return map;
}

// ----------------------------------------------------------------
// step 5 — ghost veterans
// ----------------------------------------------------------------

type GhostRow = { id: string; name: string; city: string };

async function seedGhostVeterans(): Promise<GhostRow[]> {
  console.log("• Inserting ghost veterans…");
  const rows = SEED_GHOSTS.map((g) => ({
    display_name: g.display_name,
    city: g.city,
    interests: g.interests,
    accessibility_flags: g.accessibility_flags,
    identity_prefs: "any" as const,
    show_name_publicly: true,
    reminders_enabled: false,
    language: "uk",
    comfort_notes: SEED_GHOST_MARKER,
  }));
  const { data, error } = await supabase
    .from("veterans")
    .insert(rows)
    .select("id, display_name, city");
  if (error) throw error;
  if (!data) throw new Error("No data returned from veterans insert");

  const result: GhostRow[] = data.map((d) => ({
    id: d.id,
    name: d.display_name,
    city: d.city,
  }));
  console.log(`  ✓ ${result.length} ghost veterans inserted.`);
  return result;
}

// ----------------------------------------------------------------
// step 6 — ghost RSVPs (deterministic per event)
// ----------------------------------------------------------------

async function seedGhostRsvps(eventIds: Map<string, string>, ghosts: GhostRow[]) {
  console.log("• Inserting ghost RSVPs…");
  const ghostsByCity = new Map<string, GhostRow[]>();
  for (const g of ghosts) {
    const list = ghostsByCity.get(g.city) ?? [];
    list.push(g);
    ghostsByCity.set(g.city, list);
  }

  const rows: {
    veteran_id: string;
    event_id: string;
    status: "going";
    is_ghost: true;
    show_name_publicly: true;
    reminders_enabled: false;
  }[] = [];

  for (const ev of SEED_EVENTS) {
    const eventId = eventIds.get(ev.slug);
    if (!eventId) throw new Error(`Missing event id for ${ev.slug}`);
    const localGhosts = ghostsByCity.get(ev.city) ?? [];
    if (localGhosts.length === 0) {
      console.warn(`  ⚠ No ghosts available for city ${ev.city} (event ${ev.slug})`);
      continue;
    }
    const shuffled = deterministicShuffle(localGhosts, ev.slug);
    const take = Math.min(ev.ghost_count, shuffled.length);
    for (let i = 0; i < take; i++) {
      rows.push({
        veteran_id: shuffled[i]!.id,
        event_id: eventId,
        status: "going",
        is_ghost: true,
        show_name_publicly: true,
        reminders_enabled: false,
      });
    }
  }

  const { error } = await supabase.from("rsvps").insert(rows);
  if (error) throw error;
  console.log(`  ✓ ${rows.length} ghost RSVPs inserted.`);
}

// ----------------------------------------------------------------
// step 7 — verify
// ----------------------------------------------------------------

async function verify() {
  console.log("• Verifying counts…");
  const [
    { count: events },
    { count: orgs },
    { count: ghosts },
    { count: rsvps },
    { count: cities },
  ] = await Promise.all([
    supabase.from("events").select("*", { head: true, count: "exact" }).eq("source", "admin_seed"),
    supabase
      .from("organizations")
      .select("*", { head: true, count: "exact" })
      .eq("notes", SEED_ORG_MARKER),
    supabase
      .from("veterans")
      .select("*", { head: true, count: "exact" })
      .eq("comfort_notes", SEED_GHOST_MARKER),
    supabase.from("rsvps").select("*", { head: true, count: "exact" }).eq("is_ghost", true),
    supabase.from("cities").select("*", { head: true, count: "exact" }),
  ]);

  console.log(
    `  events: ${events}, orgs: ${orgs}, ghosts: ${ghosts}, rsvps: ${rsvps}, cities: ${cities}`,
  );
}

// ----------------------------------------------------------------
// main
// ----------------------------------------------------------------

async function main() {
  console.log(`Поруч seed → ${supabaseUrl}\n`);
  await cleanSeed();
  await seedCities();
  const orgIds = await seedOrganizations();
  const eventIds = await seedEvents(orgIds);
  const ghosts = await seedGhostVeterans();
  await seedGhostRsvps(eventIds, ghosts);
  await verify();
  console.log("\n✓ Seed complete.");
}

main().catch((err) => {
  console.error("\n✗ Seed failed:", err);
  process.exit(1);
});
