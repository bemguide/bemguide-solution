import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, listQuerySchema } from '../../utils/validation.js';
import { listForUser } from '../../services/matches.service.js';

export async function meMatchesRoute(app: FastifyInstance): Promise<void> {
  app.get('/me/matches', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const q = parseOrThrow(listQuerySchema, req.query, 'query');
    return listForUser(req.user.id, q);
  });
}
