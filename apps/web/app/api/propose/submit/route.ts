// POST /api/propose/submit
// Body: { parsed }   parsed = output from /api/propose/parse
//
// Creates an events row with status='pending', source='veteran_submission',
// created_by_veteran_id=<authed veteran>. Then calls gemini-moderate and
// stores ai_screen_score / ai_screen_notes.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedVeteran } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";
import { serverEnv } from "@/lib/env";
import { ACCESSIBILITY_FLAGS, IDENTITY_PREFS, INTEREST_CATEGORIES } from "@poruch/shared";

const Parsed = z.object({
  title: z.string().min(2).max(120),
  description: z.string().min(2).max(2000),
  city: z.string().min(1),
  address: z.string().nullable().optional(),
  start_at_iso: z.string().nullable().optional(),
  duration_min: z.number().int().min(15).max(720).default(60),
  categories: z.array(z.enum(INTEREST_CATEGORIES)).default([]),
  identity_tag: z.enum(IDENTITY_PREFS).default("any"),
  accessibility_flags: z.array(z.enum(ACCESSIBILITY_FLAGS)).default([]),
  price_uah: z.number().int().min(0).max(100000).default(0),
});

const Body = z.object({ parsed: Parsed });

function slugify(title: string, fallback: string): string {
  // Latinize Cyrillic best-effort, keep ASCII letters/digits, spaces → "-".
  const map: Record<string, string> = {
    а: "a",
    б: "b",
    в: "v",
    г: "h",
    ґ: "g",
    д: "d",
    е: "e",
    є: "ie",
    ж: "zh",
    з: "z",
    и: "y",
    і: "i",
    ї: "i",
    й: "i",
    к: "k",
    л: "l",
    м: "m",
    н: "n",
    о: "o",
    п: "p",
    р: "r",
    с: "s",
    т: "t",
    у: "u",
    ф: "f",
    х: "kh",
    ц: "ts",
    ч: "ch",
    ш: "sh",
    щ: "shch",
    ь: "",
    ю: "iu",
    я: "ia",
  };
  const lower = title.toLowerCase();
  let out = "";
  for (const ch of lower) out += map[ch] ?? ch;
  out = out
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  if (out.length < 4) out = fallback;
  return `${out}-${Math.random().toString(36).slice(2, 6)}`;
}

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
  const p = parsed.data.parsed;

  if (!p.start_at_iso) {
    return NextResponse.json(
      { ok: false, error: "start_at потрібен — додай дату і час." },
      { status: 400 },
    );
  }

  const supabase = serverSupabase();
  const slug = slugify(p.title, "veteran-event");
  const { data: created, error } = await supabase
    .from("events")
    .insert({
      slug,
      title: p.title,
      short_description: p.description.split("\n")[0]?.slice(0, 120) ?? "",
      description: p.description,
      city: p.city,
      address: p.address ?? null,
      start_at: p.start_at_iso,
      duration_min: p.duration_min,
      categories: p.categories,
      identity_tag: p.identity_tag,
      accessibility_flags: p.accessibility_flags,
      price_uah: p.price_uah,
      source: "veteran_submission",
      status: "pending",
      created_by_veteran_id: auth.veteran.veteran_id,
    })
    .select("id, slug")
    .single();

  if (error || !created) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "insert failed" },
      { status: 500 },
    );
  }

  // Fire-and-forget pre-screen by gemini-moderate.
  const env = serverEnv();
  const moderateUrl = env.SUPABASE_URL.replace(
    /\.supabase\.co.*$/,
    ".supabase.co/functions/v1/gemini-moderate",
  );
  fetch(moderateUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${env.VERCEL_CRON_SECRET}`,
    },
    body: JSON.stringify({ event_id: created.id }),
  })
    .then(async (res) => {
      if (!res.ok) return;
      const j = (await res.json()) as { result?: Record<string, unknown> };
      if (!j.result) return;
      const r = j.result as {
        overall_score?: number;
        red_flags?: string[];
        suggested_edits?: string[];
      };
      await supabase
        .from("events")
        .update({
          ai_screen_score: typeof r.overall_score === "number" ? r.overall_score : null,
          ai_screen_notes: {
            red_flags: r.red_flags ?? [],
            suggested_edits: r.suggested_edits ?? [],
          },
        })
        .eq("id", created.id);
    })
    .catch((e) => console.warn("moderate failed:", (e as Error).message));

  return NextResponse.json({ ok: true, event_id: created.id, slug: created.slug });
}
