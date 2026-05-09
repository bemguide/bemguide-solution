// POST /api/propose/parse
// Body: { raw_text, prior_user_answers? }
// Verifies initData, captures veteran's city as parser default, proxies to
// gemini-parse-event, returns the parsed draft + clarifying questions.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedVeteran } from "@/lib/auth";
import { serverEnv } from "@/lib/env";

const Body = z.object({
  raw_text: z.string().min(1).max(2000),
  prior_user_answers: z.array(z.object({ question: z.string(), answer: z.string() })).optional(),
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

  const env = serverEnv();
  const url = env.SUPABASE_URL.replace(
    /\.supabase\.co.*$/,
    ".supabase.co/functions/v1/gemini-parse-event",
  );
  const today = new Date().toISOString().slice(0, 10);
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.VERCEL_CRON_SECRET}`,
    },
    body: JSON.stringify({
      raw_text: parsed.data.raw_text,
      veteran_city: auth.veteran.city ?? undefined,
      current_date: today,
      prior_user_answers: parsed.data.prior_user_answers ?? [],
    }),
  });
  const json = (await res.json()) as Record<string, unknown>;
  return NextResponse.json(json, { status: res.status });
}
