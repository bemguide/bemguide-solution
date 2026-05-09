// POST /api/admin/event/[id]/approve  — sets status='approved', logs the action,
// queues an event_published notification to the original veteran-author (if any).

import { NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";
import { serverSupabase } from "@/lib/supabase/server";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await isAdmin())) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const supabase = serverSupabase();

  const { data: event, error: gErr } = await supabase
    .from("events")
    .select("id, status, created_by_veteran_id")
    .eq("id", id)
    .maybeSingle();
  if (gErr || !event) return NextResponse.json({ ok: false, error: "not found" }, { status: 404 });
  if (event.status !== "pending") {
    return NextResponse.json({ ok: false, error: `status=${event.status}` }, { status: 409 });
  }

  const now = new Date().toISOString();
  await supabase.from("events").update({ status: "approved", published_at: now }).eq("id", id);

  await supabase.from("moderation_log").insert({
    event_id: id,
    action: "approved",
    notes: null,
  });

  if (event.created_by_veteran_id) {
    await supabase.from("notifications").insert({
      veteran_id: event.created_by_veteran_id,
      event_id: id,
      type: "event_published",
      payload: { event_id: id },
      scheduled_for: now,
      status: "pending",
    });
  }

  return NextResponse.json({ ok: true });
}
