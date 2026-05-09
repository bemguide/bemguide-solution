// Server-side helper that calls the gemini-rank edge function and falls back
// to a deterministic ordering when AI is unavailable or times out.

import { serverEnv } from "@/lib/env";
import type { UpcomingEvent } from "@/lib/queries";
import { distanceKm } from "@/lib/distance";

const GEMINI_RANK_TIMEOUT_MS = 3000;

type Ranked = UpcomingEvent & { ai_reason?: string };

export async function rankEvents({
  veteranId,
  events,
}: {
  veteranId: string;
  events: UpcomingEvent[];
}): Promise<Ranked[]> {
  if (events.length === 0) return [];
  const env = serverEnv();
  const url = env.SUPABASE_URL.replace(
    /\.supabase\.co.*$/,
    ".supabase.co/functions/v1/gemini-rank",
  );
  const cronSecret = env.VERCEL_CRON_SECRET;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEMINI_RANK_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
      body: JSON.stringify({
        veteran_id: veteranId,
        candidate_event_ids: events.map((e) => e.id),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`gemini-rank ${res.status}`);
    const json = (await res.json()) as {
      ok?: boolean;
      ranked?: { event_id: string; score: number; reason: string }[];
      fallback?: boolean;
    };
    if (!json.ok || !json.ranked) throw new Error("gemini-rank returned non-ok");
    const reasons = new Map<string, string>();
    const order = new Map<string, number>();
    json.ranked.forEach((r, i) => {
      reasons.set(r.event_id, r.reason);
      order.set(r.event_id, i);
    });
    return events
      .slice()
      .sort((a, b) => (order.get(a.id) ?? 999) - (order.get(b.id) ?? 999))
      .map((e) => ({ ...e, ai_reason: reasons.get(e.id) ?? "" }));
  } catch (e) {
    clearTimeout(timer);
    console.warn("rankEvents fell back to deterministic:", (e as Error).message);
    return deterministicRank(events);
  }
}

function deterministicRank(events: UpcomingEvent[]): Ranked[] {
  return [...events]
    .sort((a, b) => {
      const da = distanceKm(a.city, a.location_lat ?? null, a.location_lng ?? null) ?? 9999;
      const db = distanceKm(b.city, b.location_lat ?? null, b.location_lng ?? null) ?? 9999;
      if (da !== db) return da - db;
      const sa = new Date(a.start_at).getTime();
      const sb = new Date(b.start_at).getTime();
      if (sa !== sb) return sa - sb;
      if (b.going_count !== a.going_count) return b.going_count - a.going_count;
      return a.price_uah - b.price_uah;
    })
    .map((e) => ({ ...e, ai_reason: "" }));
}
