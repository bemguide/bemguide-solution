import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { signOutAccessToken } from '../../services/auth.service.js';

export async function logoutRoute(app: FastifyInstance): Promise<void> {
  app.post('/auth/logout', { preHandler: authGuard }, async (req, reply) => {
    if (req.accessToken) {
      await signOutAccessToken(req.accessToken);
    }
    reply.code(204);
    return null;
  });
}
