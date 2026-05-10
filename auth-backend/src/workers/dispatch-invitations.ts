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
  invitations_skipped_rate_limit: number;
}

async function selectionPhase(): Promise<{ events: number; inserted: number }> {
  // Find opportunities that are upcoming OR always-on (start_at is null).
  //
  // Notification gate (separate from feed scoring): only invite users whose
  // CLASSIFIED interests intersect the opportunity's classified interests by
  // at least one tag. The feed personalises by score (which sums city +
  // interest overlap + age + identity + accessibility + veteran status); a
  // pure score threshold can't enforce "≥1 interest match" because non-
  // interest factors can lift the score on their own. So we filter on the
  // arrays directly.
  //
  // Pull all matches (with the user's classified_interest embedded) and
  // filter in JS, then slice top-N. Pulling pre-filter would lose high-
  // overlap users that sit just below the score cutoff.
  const nowIso = new Date().toISOString().replace(/Z$|[+-]\d{2}:?\d{2}$/, '');

  const { data: events, error: eventsErr } = await supabaseAdmin
    .from('opportunities')
    .select('id, start_at, classified_interest')
    .or(`start_at.is.null,start_at.gte.${nowIso}`);
  if (eventsErr) throw new Error(`opportunities query failed: ${eventsErr.message}`);

  let inserted = 0;
  for (const ev of events ?? []) {
    const oppInterests = new Set<string>(ev.classified_interest ?? []);
    // No classified interests on the opportunity → no overlap is possible.
    // This usually means the classifier hasn't run on it yet (classified_at
    // IS NULL); the catch-up worker will retag it and the next dispatcher
    // run will pick it up.
    if (oppInterests.size === 0) continue;

    const { data: candidates, error: matchErr } = await supabaseAdmin
      .from('event_matches')
      .select('user_id, score, users:user_id(classified_interest)')
      .eq('event_id', ev.id)
      .order('score', { ascending: false })
      .order('user_id', { ascending: true });
    if (matchErr) throw new Error(`event_matches query failed for ${ev.id}: ${matchErr.message}`);
    if (!candidates || candidates.length === 0) continue;

    const filtered = candidates.filter((m) => {
      const userInterests = (m.users?.classified_interest ?? []) as string[];
      return userInterests.some((i) => oppInterests.has(i));
    });
    const top = filtered.slice(0, env.INVITATIONS_TOP_N);
    if (top.length === 0) continue;

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
  skipped_rate_limit: number;
}> {
  const pending = await listPendingDispatch(env.DISPATCH_BATCH_SIZE);
  let sent = 0;
  let failed = 0;
  let skipped_no_telegram = 0;
  let skipped_rate_limit = 0;

  // Per-user rate limit. Without it, a fresh user whose event_matches
  // just landed receives every matching event's invitation back-to-back
  // the next time this worker runs. For our audience that's distress,
  // not helpfulness — see env comment on INVITATIONS_MAX_PER_USER_PER_DAY.
  //
  // Strategy: count `sent` invitations in the last 24h per user, then
  // walk pending in score-desc order skipping any user whose budget is
  // exhausted (24h history + sends already made in this run). Skipped
  // rows stay in delivery_status='pending' and get reconsidered on the
  // next run when the 24h window has rolled forward.
  const cap = env.INVITATIONS_MAX_PER_USER_PER_DAY;
  const userIdsInBatch = [...new Set(pending.map((inv) => inv.user_id))];
  const recentByUser = new Map<string, number>();
  if (userIdsInBatch.length > 0) {
    const sinceIso = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { data: recent, error: recentErr } = await supabaseAdmin
      .from('event_invitations')
      .select('user_id')
      .in('user_id', userIdsInBatch)
      .eq('delivery_status', 'sent')
      .gte('sent_at', sinceIso);
    if (recentErr) {
      throw new Error(`recent-sent lookup failed: ${recentErr.message}`);
    }
    for (const row of recent ?? []) {
      recentByUser.set(row.user_id, (recentByUser.get(row.user_id) ?? 0) + 1);
    }
  }
  const sentInRunByUser = new Map<string, number>();

  // Sort by score so the strongest match a user has pending arrives
  // first within their daily budget. `score_at_invite` may be null on
  // historical rows; fall back to 0 so they sort last.
  const ordered = [...pending].sort(
    (a, b) => (b.score_at_invite ?? 0) - (a.score_at_invite ?? 0),
  );

  for (const inv of ordered) {
    const used = (recentByUser.get(inv.user_id) ?? 0) + (sentInRunByUser.get(inv.user_id) ?? 0);
    if (used >= cap) {
      // Don't mark failed — leave as pending so the next run revisits
      // it. The 24h window is rolling, so eventually the budget frees up.
      skipped_rate_limit += 1;
      continue;
    }

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
      sentInRunByUser.set(inv.user_id, (sentInRunByUser.get(inv.user_id) ?? 0) + 1);
    } catch (err) {
      failed += 1;
      const reason = err instanceof Error ? err.message : 'unknown error';
      await markFailed(inv.id, reason).catch(() => {
        /* swallow — already failing, don't throw on best-effort mark */
      });
    }
  }
  return { sent, failed, skipped_no_telegram, skipped_rate_limit };
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
    invitations_skipped_rate_limit: 0,
  };

  const sel = await selectionPhase();
  summary.events_considered = sel.events;
  summary.invitations_inserted = sel.inserted;

  const del = await deliveryPhase();
  summary.invitations_sent = del.sent;
  summary.invitations_failed = del.failed;
  summary.invitations_skipped_no_telegram = del.skipped_no_telegram;
  summary.invitations_skipped_rate_limit = del.skipped_rate_limit;

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ worker: 'dispatch-invitations', dry_run: env.DRY_RUN, ...summary }));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('dispatch-invitations failed:', err);
  process.exit(1);
});
