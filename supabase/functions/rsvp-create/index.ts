// rsvp-create — create or update an RSVP for a veteran on an event.
//
// POST { veteran_id, event_id, defer_until? }
//   → 200 { rsvp_id, qr_token, status, going_count, names_visible }
//
// Auth: Authorization: Bearer <internal-secret>. Caller (Next.js route) is
// responsible for initData verification.
//
// Side effects:
//   - Inserts rsvps row (or updates existing one to status='going').
//   - Schedules T-24h, T-10m reminders + immediate rsvp_confirm notification.

import { handleCors } from "../_shared/cors.ts";
import { ok, err } from "../_shared/responses.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { adminClient } from "../_shared/supabase.ts";
import { env } from "../_shared/env.ts";

type Body = {
  veteran_id?: string;
  event_id?: string;
  defer_until?: string;
};

function genQrToken(): string {
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!isServiceCaller(req)) return err("unauthorized", 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  if (!body.veteran_id || !body.event_id) return err("veteran_id and event_id required");

  const supabase = adminClient();
  const { data: event, error: eventErr } = await supabase
    .from("events")
    .select("id, slug, status, start_at, duration_min, title, address")
    .eq("id", body.event_id)
    .maybeSingle();
  if (eventErr) return err(`db error: ${eventErr.message}`, 500);
  if (!event) return err("event not found", 404);
  if (event.status !== "approved") return err("event not approved", 409);

  const isDeferred = Boolean(body.defer_until);
  const desiredStatus = isDeferred ? "deferred" : "going";

  // Upsert by (veteran_id, event_id) — table has a unique constraint.
  const { data: existing } = await supabase
    .from("rsvps")
    .select("id, qr_token, status")
    .eq("veteran_id", body.veteran_id)
    .eq("event_id", body.event_id)
    .maybeSingle();

  let rsvpId: string;
  let qrToken: string;
  if (existing) {
    rsvpId = existing.id;
    qrToken = existing.qr_token ?? genQrToken();
    const { error: updErr } = await supabase
      .from("rsvps")
      .update({
        status: desiredStatus,
        qr_token: qrToken,
        defer_until: body.defer_until ?? null,
      })
      .eq("id", existing.id);
    if (updErr) return err(`update failed: ${updErr.message}`, 500);
  } else {
    qrToken = genQrToken();
    const { data: created, error: insErr } = await supabase
      .from("rsvps")
      .insert({
        veteran_id: body.veteran_id,
        event_id: body.event_id,
        status: desiredStatus,
        qr_token: qrToken,
        defer_until: body.defer_until ?? null,
      })
      .select("id")
      .single();
    if (insErr || !created) return err(`insert failed: ${insErr?.message}`, 500);
    rsvpId = created.id;
  }

  // Schedule notifications. Bulk-insert then dedupe; existing rows for this rsvp
  // are removed first so reminders don't pile up after defer→going transitions.
  await supabase
    .from("notifications")
    .delete()
    .eq("rsvp_id", rsvpId)
    .in("type", ["rsvp_confirm", "reminder_24h", "reminder_10m"]);

  const now = new Date();
  const startMs = new Date(event.start_at).getTime();
  const reminders: { type: string; scheduled_for: string }[] = [];
  if (!isDeferred) {
    reminders.push({ type: "rsvp_confirm", scheduled_for: now.toISOString() });
    const t24 = new Date(startMs - 24 * 3600 * 1000);
    if (t24 > now) reminders.push({ type: "reminder_24h", scheduled_for: t24.toISOString() });
    const t10 = new Date(startMs - 10 * 60 * 1000);
    if (t10 > now) reminders.push({ type: "reminder_10m", scheduled_for: t10.toISOString() });
  } else if (body.defer_until) {
    // Defer: remind 1 day before the defer window ends.
    const deferRemind = new Date(new Date(body.defer_until).getTime() - 24 * 3600 * 1000);
    if (deferRemind > now) {
      reminders.push({ type: "rsvp_confirm", scheduled_for: deferRemind.toISOString() });
    }
  }

  if (reminders.length) {
    const rows = reminders.map((r) => ({
      veteran_id: body.veteran_id!,
      event_id: body.event_id!,
      rsvp_id: rsvpId,
      type: r.type,
      payload: { event_id: body.event_id, rsvp_id: rsvpId, slug: event.slug },
      scheduled_for: r.scheduled_for,
      status: "pending",
    }));
    await supabase.from("notifications").insert(rows);

    // Fire-and-forget kick to the scheduler so rsvp_confirm fires within a few
    // seconds rather than waiting for the next cron tick.
    const schedulerUrl = env
      .supabaseUrl()
      .replace(/\.supabase\.co.*$/, ".supabase.co/functions/v1/notify-scheduler");
    fetch(schedulerUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: `Bearer ${env.cronSecret()}`,
      },
    }).catch((e) => console.warn("scheduler kick failed:", e));
  }

  // Public counts after the write.
  const { data: counts } = await supabase.rpc("public_rsvp_count", {
    p_event_id: body.event_id,
  });
  type Row = { going_count: number; names_visible: string[] | null };
  const c = (counts as Row[] | null)?.[0] ?? { going_count: 0, names_visible: [] };

  return ok({
    rsvp_id: rsvpId,
    qr_token: qrToken,
    status: desiredStatus,
    going_count: c.going_count,
    names_visible: c.names_visible ?? [],
  });
});
