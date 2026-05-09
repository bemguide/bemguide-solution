/**
 * dispatch-invitations.ts — one-shot cron worker.
 *
 * Phase A (selection): for every upcoming opportunity that has any matches,
 *   pick the top INVITATIONS_TOP_N by score and insert event_invitations rows
 *   (channel='telegram', scheduled_for=now()). Sticky-decline preserved by the
 *   unique (event_id, user_id) constraint — duplicate inserts are skipped.
 *
 * Phase B (delivery): pull a batch of pending invitations whose scheduled_for
 *   has passed, fetch the user's telegram_user_id, send via Bot API, mark sent
 *   or failed.
 *
 * Designed to be idempotent under cron retries:
 *   - phase A is upsert-with-skip (no double-invite)
 *   - phase B uses delivery_status='pending' as the work signal — a partial
 *     send + crash leaves the row in pending and the next run resumes
 *
 * Schedule via external cron (Fly cron, GitHub Actions, supabase pg_cron-into-
 * webhook, etc). Do NOT run more than one instance concurrently — the SELECT
 * in phase B is not locked.
 */
import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import {
  insertForDispatch,
  listPendingDispatch,
  markFailed,
  markSent,
} from '../services/invitations.service.js';
import { sendMessage } from '../services/telegram.service.js';

interface DispatchSummary {
  events_considered: number;
  invitations_inserted: number;
  invitations_sent: number;
  invitations_failed: number;
  invitations_skipped_no_telegram: number;
}

async function selectionPhase(): Promise<{ events: number; inserted: number }> {
  // Find opportunities that are upcoming OR always-on (start_at is null) and
  // have at least one row in event_matches that we haven't already invited.
  // We do this in two queries to keep the SQL simple — the candidate set is
  // small (active opportunities × top_N).
  const nowIso = new Date().toISOString().replace(/Z$|[+-]\d{2}:?\d{2}$/, '');

  const { data: events, error: eventsErr } = await supabaseAdmin
    .from('opportunities')
    .select('id, start_at')
    .or(`start_at.is.null,start_at.gte.${nowIso}`);
  if (eventsErr) throw new Error(`opportunities query failed: ${eventsErr.message}`);

  let inserted = 0;
  for (const ev of events ?? []) {
    const { data: top, error: matchErr } = await supabaseAdmin
      .from('event_matches')
      .select('user_id, score')
      .eq('event_id', ev.id)
      .order('score', { ascending: false })
      .order('user_id', { ascending: true })
      .limit(env.INVITATIONS_TOP_N);
    if (matchErr) throw new Error(`event_matches query failed for ${ev.id}: ${matchErr.message}`);
    if (!top || top.length === 0) continue;

    const rows = top.map((m) => ({
      event_id: ev.id,
      user_id: m.user_id,
      score_at_invite: m.score,
      channel: 'telegram',
      scheduled_for: new Date().toISOString(),
    }));
    const written = await insertForDispatch(rows);
    inserted += written.length;
  }

  return { events: events?.length ?? 0, inserted };
}

async function deliveryPhase(): Promise<{
  sent: number;
  failed: number;
  skipped_no_telegram: number;
}> {
  const pending = await listPendingDispatch(env.DISPATCH_BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  let skipped_no_telegram = 0;

  for (const inv of pending) {
    try {
      const { data: user, error: userErr } = await supabaseAdmin
        .from('users')
        .select('telegram_user_id, display_name')
        .eq('id', inv.user_id)
        .maybeSingle();
      if (userErr) throw new Error(`users lookup failed: ${userErr.message}`);
      if (!user?.telegram_user_id) {
        skipped_no_telegram += 1;
        await markFailed(inv.id, 'user has no telegram_user_id');
        failed += 1;
        continue;
      }

      const text = inviteText(inv.opportunities?.title ?? 'Подія', inv.event_id);
      const result = await sendMessage(user.telegram_user_id, text);
      const messageId = (result as { message_id?: number }).message_id ?? null;
      await markSent(inv.id, messageId === null ? null : String(messageId));
      sent += 1;
    } catch (err) {
      failed += 1;
      const reason = err instanceof Error ? err.message : 'unknown error';
      await markFailed(inv.id, reason).catch(() => {
        /* swallow — already failing, don't throw on best-effort mark */
      });
    }
  }
  return { sent, failed, skipped_no_telegram };
}

function inviteText(title: string, eventId: string): string {
  // Cold-start invitation. Mini App deep-link with the `evt_` prefix the
  // frontend's `/` route matches to redirect into `/m/event/<event_id>`.
  // Same string shape that `buildEventShareUrl` produces on the share path,
  // so message-vs-share land users in the same place.
  // If TELEGRAM_BOT_USERNAME is unset (e.g. local dev without a real bot),
  // omit the link entirely rather than ship a broken URL.
  const link = env.TELEGRAM_BOT_USERNAME
    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=evt_${eventId}`
    : '';
  return link ? `Тебе запрошено: ${title}\n\n${link}` : `Тебе запрошено: ${title}`;
}

async function main(): Promise<void> {
  const summary: DispatchSummary = {
    events_considered: 0,
    invitations_inserted: 0,
    invitations_sent: 0,
    invitations_failed: 0,
    invitations_skipped_no_telegram: 0,
  };

  const sel = await selectionPhase();
  summary.events_considered = sel.events;
  summary.invitations_inserted = sel.inserted;

  const del = await deliveryPhase();
  summary.invitations_sent = del.sent;
  summary.invitations_failed = del.failed;
  summary.invitations_skipped_no_telegram = del.skipped_no_telegram;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ worker: 'dispatch-invitations', dry_run: env.DRY_RUN, ...summary }));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('dispatch-invitations failed:', err);
  process.exit(1);
});
