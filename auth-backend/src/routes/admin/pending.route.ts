import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../../plugins/admin-guard.js';
import { listPending } from '../../services/verification.service.js';

interface PendingQuery {
  limit?: string;
  cursor?: string;
}

export async function pendingRoute(app: FastifyInstance): Promise<void> {
  app.get('/admin/users/pending', { preHandler: adminGuard }, async (req) => {
    const q = (req.query ?? {}) as PendingQuery;
    const limit = q.limit ? Number(q.limit) : undefined;
    return listPending({ limit, cursor: q.cursor });
  });
}
