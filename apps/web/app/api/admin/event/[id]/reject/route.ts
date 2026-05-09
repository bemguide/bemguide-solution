// POST /api/admin/event/[id]/reject — sets status='rejected', logs reason.

import { NextResponse } from "next/server";
import { z } from "zod";
import { isAdmin } from "@/lib/admin";
import { serverSupabase } from "@/lib/supabase/server";

const Body = z.object({ reason: z.string().min(2).max(500) });

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;

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
  const { data: event } = await supabase
    .from("events")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!event) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (event.status !== "pending") {
    return NextResponse.json({ ok: false, error: `status=${event.status}` }, { status: 409 });
  }

  await supabase
    .from("events")
    .update({ status: "rejected", moderator_notes: parsed.data.reason })
    .eq("id", id);

  await supabase.from("moderation_log").insert({
    event_id: id,
    action: "rejected",
    notes: parsed.data.reason,
  });

  return NextResponse.json({ ok: true });
}
