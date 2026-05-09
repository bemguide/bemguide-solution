// POST /api/rsvp/create
// Body: { event_id, defer?: boolean, defer_until?: string, display_name? }
//
// Verifies initData, optionally captures display_name, then proxies to the
// rsvp-create edge function which handles the DB write + notification scheduling.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedVeteran } from "@/lib/auth";
import { serverEnv } from "@/lib/env";
import { serverSupabase } from "@/lib/supabase/server";

const Body = z.object({
  event_id: z.string().uuid(),
  defer: z.boolean().optional(),
  defer_until: z.string().datetime().optional(),
  display_name: z.string().min(1).max(80).optional(),
});

export async function POST(req: Request) {
  const auth = await authedVeteran(req);
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON" }, { status: 400 });
  }
  const parsed = Body.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: parsed.error.message }, { status: 400 });
  }

  // Capture display_name on first RSVP if missing.
  if (parsed.data.display_name && !auth.veteran.display_name) {
    await serverSupabase()
      .from("veterans")
      .update({ display_name: parsed.data.display_name })
      .eq("id", auth.veteran.veteran_id);
  }

  const env = serverEnv();
  const url = env.SUPABASE_URL.replace(
    /\.supabase\.co.*$/,
    ".supabase.co/functions/v1/rsvp-create",
  );
  const deferUntil = parsed.data.defer
    ? (parsed.data.defer_until ?? new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString())
    : undefined;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.VERCEL_CRON_SECRET}`,
    },
    body: JSON.stringify({
      veteran_id: auth.veteran.veteran_id,
      event_id: parsed.data.event_id,
      defer_until: deferUntil,
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return NextResponse.json(json, { status: res.status });
}
