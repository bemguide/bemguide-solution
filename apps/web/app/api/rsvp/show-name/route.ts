// POST /api/rsvp/show-name — toggle the per-rsvp show_name_publicly flag.

import { NextResponse } from "next/server";
import { z } from "zod";
import { authedVeteran } from "@/lib/auth";
import { serverSupabase } from "@/lib/supabase/server";

const Body = z.object({
  rsvp_id: z.string().uuid(),
  show: z.boolean(),
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

  const supabase = serverSupabase();
  // Confirm the rsvp belongs to the caller before mutating.
  const { data: rsvp } = await supabase
    .from("rsvps")
    .select("id, veteran_id")
    .eq("id", parsed.data.rsvp_id)
    .maybeSingle();
  if (!rsvp || rsvp.veteran_id !== auth.veteran.veteran_id) {
    return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  }

  const { error } = await supabase
    .from("rsvps")
    .update({ show_name_publicly: parsed.data.show })
    .eq("id", parsed.data.rsvp_id);
  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
