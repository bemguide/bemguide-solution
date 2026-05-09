// Typed query helpers used by the Gemini edge functions to load context from Postgres.
// All queries use the service-role client; callers are responsible for verifying
// the request before invoking these.

import { adminClient } from "./supabase.ts";

export type VeteranProfile = {
  id: string;
  display_name: string | null;
  city: string | null;
  oblast: string | null;
  interests: string[];
  accessibility_flags: string[];
  identity_prefs: string;
  comfort_notes: string | null;
  show_name_publicly: boolean;
};

export async function loadVeteran(id: string): Promise<VeteranProfile | null> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("veterans")
    .select(
      "id, display_name, city, oblast, interests, accessibility_flags, identity_prefs, comfort_notes, show_name_publicly",
    )
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const profile = data as VeteranProfile;
  // Strip internal markers (e.g. seed-ghost tag) before exposing to AI prompts.
  if (profile.comfort_notes && /^\[.+\]$/.test(profile.comfort_notes.trim())) {
    profile.comfort_notes = null;
  }
  return profile;
}

export type EventForRank = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  city: string;
  address: string | null;
  location_lat: number | null;
  location_lng: number | null;
  start_at: string;
  duration_min: number;
  categories: string[];
  identity_tag: string;
  accessibility_flags: string[];
  honest_absences: string[] | null;
  price_uah: number;
};

export async function loadEvents(ids: string[]): Promise<EventForRank[]> {
  if (!ids.length) return [];
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, slug, title, short_description, city, address, location_lat, location_lng, start_at, duration_min, categories, identity_tag, accessibility_flags, honest_absences, price_uah",
    )
    .in("id", ids)
    .eq("status", "approved");
  if (error) throw error;
  return (data ?? []) as EventForRank[];
}

/**
 * For each event, return the count of going RSVPs and the names of veterans who
 * opted-in publicly. Includes ghost RSVPs so demo social proof is non-empty.
 */
export async function loadAttendance(
  eventIds: string[],
): Promise<Map<string, { going_count: number; names_visible: string[] }>> {
  const out = new Map<string, { going_count: number; names_visible: string[] }>();
  if (!eventIds.length) return out;
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("rsvps")
    .select("event_id, show_name_publicly, veterans(display_name, show_name_publicly)")
    .in("event_id", eventIds)
    .eq("status", "going");
  if (error) throw error;
  type Row = {
    event_id: string;
    show_name_publicly: boolean;
    veterans: { display_name: string | null; show_name_publicly: boolean } | null;
  };
  // supabase-js types nested joins as arrays without generated DB types; cast to the
  // shape we know is correct (single FK = single object).
  for (const row of (data ?? []) as unknown as Row[]) {
    const slot = out.get(row.event_id) ?? { going_count: 0, names_visible: [] };
    slot.going_count += 1;
    if (row.show_name_publicly && row.veterans?.show_name_publicly && row.veterans?.display_name) {
      slot.names_visible.push(row.veterans.display_name);
    }
    out.set(row.event_id, slot);
  }
  return out;
}

/**
 * Past attendance and skip categories for ranking context.
 */
export async function loadVeteranHistory(
  veteranId: string,
): Promise<{ attended: string[]; skipped: string[] }> {
  const supabase = adminClient();
  const { data, error } = await supabase
    .from("rsvps")
    .select("status, events(categories)")
    .eq("veteran_id", veteranId)
    .in("status", ["attended", "declined"]);
  if (error) throw error;
  const attended = new Set<string>();
  const skipped = new Set<string>();
  type Row = { status: string; events: { categories: string[] | null } | null };
  for (const row of (data ?? []) as unknown as Row[]) {
    const cats = row.events?.categories ?? [];
    for (const c of cats) (row.status === "attended" ? attended : skipped).add(c);
  }
  return { attended: [...attended], skipped: [...skipped] };
}
