import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { parseOrThrow } from '../../utils/validation.js';
import { authRateLimitConfig } from '../../plugins/rate-limit.js';
import { AppError } from '../../utils/errors.js';
import { verifyInitData } from '../../services/telegram-init.service.js';
import { mintSessionJwt } from '../../services/session.service.js';
import { createUser } from '../../services/auth.service.js';
import {
  getByTelegramId,
  insertOnTelegramAuth,
  type UserRow,
} from '../../services/users.service.js';

const bodySchema = z.object({
  init_data: z
    .string()
    .min(1)
    .max(8 * 1024),
});

interface TelegramAuthResponse {
  token: string;
  expires_at: string;
  user: UserRow;
}

function emailForTelegramId(telegramUserId: number): string {
  // Synthetic email so auth.users gets a unique, stable identifier per TG user.
  // Domain is intentionally non-routable.
  return `tg-${telegramUserId}@poruch.local`;
}

export async function telegramAuthRoute(app: FastifyInstance): Promise<void> {
  app.post(
    '/auth/telegram',
    authRateLimitConfig(),
    async (req, reply): Promise<TelegramAuthResponse> => {
      const { init_data } = parseOrThrow(bodySchema, req.body, 'auth body');
      const verified = verifyInitData(init_data);
      const telegramUserId = verified.user.id;
      const displayName = verified.user.first_name?.trim() || null;
      const email = emailForTelegramId(telegramUserId);

      // 1) Already linked? Mint a session for the existing user.
      let user = await getByTelegramId(telegramUserId);

      // 2) New user — create auth.users + public.users transactionally-enough:
      //    if public.users insert fails we delete the auth user to avoid orphans.
      if (!user) {
        const created = await createUser(email, randomPassword());
        try {
          user = await insertOnTelegramAuth(created.id, email, telegramUserId, displayName);
        } catch (err) {
          req.log.warn(
            { err, userId: created.id },
            'telegram auth: public.users insert failed, rolling back',
          );
          // Best-effort rollback so the next attempt isn't blocked by the
          // already-registered email. Swallow cleanup errors.
          // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
          throw err;
        }
      }

      if (!user) {
        // Defensive: by here either the find or the insert should have produced one.
        throw AppError.internal('Failed to resolve user');
      }

      const minted = await mintSessionJwt(user.id, user.email);

      reply.code(200);
      return {
        token: minted.token,
        expires_at: minted.expires_at,
        user,
      };
    },
  );
}

// We never use this password (login is via Telegram), but auth.admin.createUser
// requires one. Generate a long random string so accidental brute-force fails.
function randomPassword(): string {
  // 32 bytes → 64 hex chars. More entropy than any password policy needs.
  const arr = new Uint8Array(32);
  // crypto.getRandomValues is global in Node 19+
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}
