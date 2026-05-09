// SSR queries used by public + miniapp routes. All read via the service role,
// but we explicitly filter to public-safe rows (events.status='approved' etc.)
// so that deserialised data never leaks pending content.

import { serverSupabase } from "@/lib/supabase/server";
import type { EventForDisplay } from "@/lib/types";

export async function getEventBySlug(slug: string): Promise<EventForDisplay | null> {
  const supabase = serverSupabase();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, slug, title, short_description, description, photo_url, city, oblast, address, location_lat, location_lng, start_at, duration_min, categories, identity_tag, accessibility_flags, honest_absences, price_uah, organizer_contact, status",
    )
    .eq("slug", slug)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  if (data.status !== "approved") return null;
  return data as unknown as EventForDisplay;
}

export async function getPublicRsvpCount(
  eventId: string,
): Promise<{ going_count: number; names_visible: string[] }> {
  const supabase = serverSupabase();
  const { data, error } = await supabase.rpc("public_rsvp_count", { p_event_id: eventId });
  if (error) throw error;
  // RPC returns a single-row table. supabase-js returns array of rows.
  type Row = { going_count: number; names_visible: string[] | null };
  const row = (data as unknown as Row[])?.[0];
  return {
    going_count: row?.going_count ?? 0,
    names_visible: row?.names_visible ?? [],
  };
}

export async function getNextSimilarEvent(prev: EventForDisplay): Promise<EventForDisplay | null> {
  const supabase = serverSupabase();
  const { data, error } = await supabase
    .from("events")
    .select(
      "id, slug, title, short_description, description, photo_url, city, oblast, address, location_lat, location_lng, start_at, duration_min, categories, identity_tag, accessibility_flags, honest_absences, price_uah, organizer_contact, status",
    )
    .eq("status", "approved")
    .eq("city", prev.city)
    .gt("start_at", new Date().toISOString())
    .neq("id", prev.id)
    .order("start_at", { ascending: true })
    .limit(1);
  if (error) throw error;
  return (data?.[0] ?? null) as unknown as EventForDisplay | null;
}

export type UpcomingEvent = EventForDisplay & {
  going_count: number;
  names_visible: string[];
};

/**
 * Pull upcoming approved events for a city, joined with attendance counts.
 * Used by the miniapp feed and the map view.
 */
export async function getUpcomingEvents(opts: {
  city?: string;
  limit?: number;
}): Promise<UpcomingEvent[]> {
  const supabase = serverSupabase();
  let q = supabase
    .from("events")
    .select(
      "id, slug, title, short_description, photo_url, city, oblast, address, location_lat, location_lng, start_at, duration_min, categories, identity_tag, accessibility_flags, honest_absences, price_uah",
    )
    .eq("status", "approved")
    .gt("start_at", new Date().toISOString())
    .order("start_at", { ascending: true });
  if (opts.city) q = q.eq("city", opts.city);
  q = q.limit(opts.limit ?? 30);
  const { data, error } = await q;
  if (error) throw error;
  const events = (data ?? []) as unknown as EventForDisplay[];

  // Attach attendance counts in one batched query.
  const ids = events.map((e) => e.id);
  if (!ids.length) return [];
  const counts = new Map<string, { going_count: number; names_visible: string[] }>();
  await Promise.all(
    ids.map(async (id) => {
      const c = await getPublicRsvpCount(id);
      counts.set(id, c);
    }),
  );
  return events.map((e) => ({
    ...e,
    going_count: counts.get(e.id)?.going_count ?? 0,
    names_visible: counts.get(e.id)?.names_visible ?? [],
  }));
}
