// notify-scheduler — dispatcher for pending notifications.
//
// POST  (no body)  → 200 { sent, failed, processed }
// Auth: cron secret OR service-role bearer.
//
// Strategy:
//   1. SELECT pending notifications WHERE scheduled_for <= now() LIMIT 50.
//   2. For each: load event + rsvp + veteran, render template, send via TG.
//   3. Mark sent/failed; bump retry_count; cap at 3 attempts before marking failed permanently.
//
// Triggered by Vercel cron via /api/cron/notify (which posts here with the
// internal bearer). Can also be hit manually from the admin "send now" button.

import { handleCors } from "../_shared/cors.ts";
import { ok, err } from "../_shared/responses.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { adminClient } from "../_shared/supabase.ts";
import {
  renderRsvpConfirm,
  renderReminder24h,
  renderReminder10m,
  renderPostEvent,
  renderEventPublished,
  tgSend,
  type EventCtx,
  type RsvpCtx,
  type SocialProof,
} from "../_shared/notify-templates.ts";

const BATCH = 50;
const MAX_RETRIES = 3;

type PendingRow = {
  id: number;
  veteran_id: string;
  event_id: string | null;
  rsvp_id: string | null;
  type: string;
  payload: Record<string, unknown>;
  retry_count: number;
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!isServiceCaller(req)) return err("unauthorized", 401);

  const supabase = adminClient();
  const { data: pending, error: pErr } = await supabase
    .from("notifications")
    .select("id, veteran_id, event_id, rsvp_id, type, payload, retry_count")
    .eq("status", "pending")
    .lte("scheduled_for", new Date().toISOString())
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);
  if (pErr) return err(`db error: ${pErr.message}`, 500);

  let sent = 0;
  let failed = 0;
  const processed = pending?.length ?? 0;

  for (const row of (pending ?? []) as PendingRow[]) {
    const success = await dispatchOne(row);
    if (success) {
      await supabase
        .from("notifications")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .eq("id", row.id);
      sent++;
    } else {
      const nextRetry = row.retry_count + 1;
      const finalFail = nextRetry >= MAX_RETRIES;
      await supabase
        .from("notifications")
        .update({
          status: finalFail ? "failed" : "pending",
          retry_count: nextRetry,
          failure_reason: "tg send failed",
          // Push next retry 5 minutes out so we don't hot-loop.
          scheduled_for: finalFail
            ? new Date().toISOString()
            : new Date(Date.now() + 5 * 60_000).toISOString(),
        })
        .eq("id", row.id);
      failed++;
    }
  }

  return ok({ processed, sent, failed });
});

async function dispatchOne(row: PendingRow): Promise<boolean> {
  const supabase = adminClient();
  const { data: veteran } = await supabase
    .from("veterans")
    .select("tg_user_id, display_name, reminders_enabled")
    .eq("id", row.veteran_id)
    .maybeSingle();
  if (!veteran?.tg_user_id) {
    // No TG account on file — drop silently.
    return true;
  }
  // Reminder opt-out: skip reminder_* but still allow rsvp_confirm and post_event.
  if (!veteran.reminders_enabled && (row.type === "reminder_24h" || row.type === "reminder_10m")) {
    return true;
  }

  let event: EventCtx | null = null;
  if (row.event_id) {
    const { data } = await supabase
      .from("events")
      .select("id, slug, title, address, start_at, organizer_contact")
      .eq("id", row.event_id)
      .maybeSingle();
    event = data;
  }

  let rsvp: RsvpCtx | null = null;
  if (row.rsvp_id) {
    const { data } = await supabase
      .from("rsvps")
      .select("id, qr_token")
      .eq("id", row.rsvp_id)
      .maybeSingle();
    rsvp = data
      ? { id: data.id, qr_token: data.qr_token, veteran_display_name: veteran.display_name }
      : null;
  }

  let rendered;
  if (row.type === "rsvp_confirm" && event && rsvp) {
    rendered = renderRsvpConfirm(event, rsvp);
  } else if (row.type === "reminder_24h" && event && rsvp) {
    const social = await loadSocialProof(row.event_id!);
    rendered = renderReminder24h(event, rsvp, social);
  } else if (row.type === "reminder_10m" && event && rsvp) {
    rendered = renderReminder10m(event, rsvp);
  } else if (row.type === "post_event" && event && rsvp) {
    rendered = renderPostEvent(event, rsvp);
  } else if (row.type === "event_published" && event) {
    rendered = renderEventPublished(event);
  } else {
    return false;
  }

  return await tgSend(veteran.tg_user_id, rendered);
}

async function loadSocialProof(eventId: string): Promise<SocialProof> {
  const supabase = adminClient();
  const { data } = await supabase.rpc("public_rsvp_count", { p_event_id: eventId });
  type Row = { going_count: number; names_visible: string[] | null };
  const r = (data as Row[] | null)?.[0];
  return {
    going_count: r?.going_count ?? 0,
    names_visible: r?.names_visible ?? [],
  };
}
