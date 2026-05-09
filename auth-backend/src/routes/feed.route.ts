import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../plugins/auth-guard.js';
import { AppError } from '../utils/errors.js';
import { parseOrThrow } from '../utils/validation.js';
import { buildFeed } from '../services/feed.service.js';

const querySchema = z.object({
  city: z.string().min(1).max(120).optional(),
});

export async function feedRoute(app: FastifyInstance): Promise<void> {
  app.get('/feed', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const { city } = parseOrThrow(querySchema, req.query, 'query');
    return buildFeed(req.user.id, city);
  });
}
