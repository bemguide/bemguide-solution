// GET /api/feed
// Returns the personalized feed for the authenticated veteran:
//  - 3 sections (today_tomorrow / this_week / try_new)
//  - city defaults to veteran's city; ?city=… overrides
//
// SSR-safe: all heavy lifting (DB + AI rank) happens server-side.

import { NextResponse } from "next/server";
import { authedVeteran } from "@/lib/auth";
import { getUpcomingEvents } from "@/lib/queries";
import { rankEvents } from "@/lib/feed";
import { distanceKm, hoursUntil } from "@/lib/distance";
import type { EventForDisplay } from "@/lib/types";

const HORIZON_TODAY_TOMORROW_HOURS = 36;
const HORIZON_WEEK_HOURS = 24 * 7;

export async function GET(req: Request) {
  const auth = await authedVeteran(req);
  if (!auth.ok) return auth.response;

  const { searchParams } = new URL(req.url);
  const city = searchParams.get("city") ?? auth.veteran.city ?? "Київ";

  const upcoming = await getUpcomingEvents({ city, limit: 30 });

  const ranked = await rankEvents({
    veteranId: auth.veteran.veteran_id,
    events: upcoming,
  });

  // Apply derived fields used by EventCard.
  const decorated = ranked.map((e) => ({
    ...e,
    distance_km: distanceKm(city, e.location_lat ?? null, e.location_lng ?? null),
    going_count: e.going_count ?? 0,
    names_visible: e.names_visible ?? [],
  })) as (EventForDisplay & { ai_reason?: string })[];

  const today = decorated.filter((e) => hoursUntil(e.start_at) <= HORIZON_TODAY_TOMORROW_HOURS);
  const week = decorated.filter(
    (e) =>
      hoursUntil(e.start_at) > HORIZON_TODAY_TOMORROW_HOURS &&
      hoursUntil(e.start_at) <= HORIZON_WEEK_HOURS,
  );
  const tryNew = decorated.slice(0, 1).map((e) => ({ ...e, ai_reason: e.ai_reason ?? "" }));

  return NextResponse.json({
    ok: true,
    city,
    sections: {
      today_tomorrow: today.slice(0, 5),
      this_week: week.slice(0, 12),
      try_new: tryNew,
    },
  });
}
