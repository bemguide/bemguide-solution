// POST /api/veteran/upsert
// Used by the onboarding flow to update the veteran's profile incrementally.
// Body fields are all optional; only present fields are written.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedVeteran } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";
import { ACCESSIBILITY_FLAGS, IDENTITY_PREFS, INTEREST_CATEGORIES } from "@poruch/shared";

const Body = z.object({
  display_name: z.string().min(1).max(80).optional(),
  city: z.string().min(1).max(80).optional(),
  oblast: z.string().max(80).nullable().optional(),
  interests: z.array(z.enum(INTEREST_CATEGORIES)).optional(),
  accessibility_flags: z.array(z.enum(ACCESSIBILITY_FLAGS)).optional(),
  identity_prefs: z.enum(IDENTITY_PREFS).optional(),
  comfort_notes: z.string().max(500).nullable().optional(),
  show_name_publicly: z.boolean().optional(),
  reminders_enabled: z.boolean().optional(),
  mark_onboarded: z.boolean().optional(),
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
  const patch = parsed.data;
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === "mark_onboarded") continue;
    if (v !== undefined) update[k] = v;
  }
  if (patch.mark_onboarded) update.onboarded_at = new Date().toISOString();
  if (Object.keys(update).length === 0) {
    return NextResponse.json({ ok: true, veteran_id: auth.veteran.veteran_id });
  }

  const supabase = serverSupabase();
  const { error } = await supabase
    .from("veterans")
    .update(update)
    .eq("id", auth.veteran.veteran_id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, veteran_id: auth.veteran.veteran_id });
}
