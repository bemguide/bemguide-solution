import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, listQuerySchema, respondInvitationSchema } from '../../utils/validation.js';
import { listForUser, respond } from '../../services/invitations.service.js';

export async function meInvitationsRoute(app: FastifyInstance): Promise<void> {
  app.get('/me/invitations', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const q = parseOrThrow(listQuerySchema, req.query, 'query');
    return listForUser(req.user.id, q);
  });

  app.patch<{ Params: { id: string } }>(
    '/me/invitations/:id',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const { response } = parseOrThrow(respondInvitationSchema, req.body, 'response');
      return respond(req.user.id, req.params.id, response);
    },
  );
}
