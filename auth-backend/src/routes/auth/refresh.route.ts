import type { FastifyInstance } from 'fastify';
import { AppError } from '../../utils/errors.js';
import { refreshSession } from '../../services/auth.service.js';

interface RefreshBody {
  refresh_token?: string;
}

export async function refreshRoute(app: FastifyInstance): Promise<void> {
  app.post('/auth/refresh', async (req) => {
    const body = (req.body ?? {}) as RefreshBody;
    if (!body.refresh_token) throw AppError.validation('refresh_token is required');
    const session = await refreshSession(body.refresh_token);
    return { session };
  });
}
