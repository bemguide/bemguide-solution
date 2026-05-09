/**
 * provision-rooms.ts — one-shot cron worker.
 *
 * Reads event_rooms WHERE chat_provider IS NULL (matches the partial index
 * event_rooms_pending_provision_idx), creates a Telegram chat for each, and
 * writes back chat_provider/chat_external_id/chat_invite_url/chat_created_at.
 *
 * Idempotent under retries: rows that are still null after a crash get picked
 * up again next run; once chat_provider is set, the row no longer matches the
 * select predicate.
 */
import { env } from '../config/env.js';
import { listPendingProvision, markProvisioned } from '../services/rooms.service.js';
import { createChatForEvent } from '../services/telegram.service.js';

interface ProvisionSummary {
  rooms_considered: number;
  rooms_provisioned: number;
  rooms_failed: number;
}

async function main(): Promise<void> {
  const summary: ProvisionSummary = {
    rooms_considered: 0,
    rooms_provisioned: 0,
    rooms_failed: 0,
  };

  const pending = await listPendingProvision(env.ROOMS_PROVISION_BATCH_SIZE);
  summary.rooms_considered = pending.length;

  for (const room of pending) {
    try {
      const created = await createChatForEvent(room.event_id);
      await markProvisioned(room.event_id, {
        chat_provider: 'telegram',
        chat_external_id: created.chat_external_id,
        chat_invite_url: created.chat_invite_url,
      });
      summary.rooms_provisioned += 1;
    } catch (err) {
      summary.rooms_failed += 1;
      // eslint-disable-next-line no-console
      console.error(`provision failed for event_id=${room.event_id}:`, err);
    }
  }

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ worker: 'provision-rooms', dry_run: env.DRY_RUN, ...summary }));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('provision-rooms failed:', err);
  process.exit(1);
});
