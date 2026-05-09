// /api/cron/notify
// Triggered by Vercel cron (vercel.json). Vercel signs the request with
// `Authorization: Bearer ${VERCEL_CRON_SECRET}` (when set in dashboard).
// We forward to the Supabase notify-scheduler edge fn with the same bearer.

import { NextResponse } from "next/server";
import { serverEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

async function trigger() {
  const env = serverEnv();
  const url = env.SUPABASE_URL.replace(
    /\.supabase\.co.*$/,
    ".supabase.co/functions/v1/notify-scheduler",
  );
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.VERCEL_CRON_SECRET}`,
    },
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, json };
}

function authorized(req: Request, env: ReturnType<typeof serverEnv>): boolean {
  // Vercel cron sends Authorization: Bearer <CRON_SECRET>.
  const auth = req.headers.get("authorization") ?? "";
  if (auth.startsWith("Bearer ") && auth.slice(7).trim() === env.VERCEL_CRON_SECRET) return true;
  return false;
}

export async function GET(req: Request) {
  const env = serverEnv();
  if (!authorized(req, env)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { status, json } = await trigger();
  return NextResponse.json(json, { status });
}

export async function POST(req: Request) {
  return GET(req);
}
