import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, telegramLinkSchema } from '../../utils/validation.js';
import { verifyOneTimeLinkToken } from '../../services/telegram.service.js';
import { updateTelegramLink } from '../../services/users.service.js';

export async function meTelegramRoute(app: FastifyInstance): Promise<void> {
  app.post('/me/telegram/link', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const { token } = parseOrThrow(telegramLinkSchema, req.body, 'link request');
    const { telegram_user_id } = verifyOneTimeLinkToken(token);
    const profile = await updateTelegramLink(req.user.id, telegram_user_id);
    return { profile };
  });
}
