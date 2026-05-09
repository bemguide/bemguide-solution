import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../../plugins/admin-guard.js';
import { AppError } from '../../utils/errors.js';
import { approve, reject } from '../../services/verification.service.js';

interface IdParams {
  id: string;
}

interface RejectBody {
  reason?: string;
}

export async function reviewRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: IdParams }>(
    '/admin/users/:id/approve',
    { preHandler: adminGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const profile = await approve(req.params.id, req.user.id);
      return { profile };
    },
  );

  app.post<{ Params: IdParams; Body: RejectBody }>(
    '/admin/users/:id/reject',
    { preHandler: adminGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const reason = (req.body?.reason ?? '').trim();
      if (!reason) throw AppError.validation('reason is required');
      const profile = await reject(req.params.id, req.user.id, reason);
      return { profile };
    },
  );
}
