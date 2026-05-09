import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../plugins/auth-guard.js';
import { AppError } from '../utils/errors.js';
import { parseOrThrow } from '../utils/validation.js';
import { listForUser } from '../services/matches.service.js';
import { serializeOpportunityTimes } from '../utils/time.js';

const querySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(2048).optional(),
});

// Contract: GET /matches?limit=20 returns top-N {opportunity, score} pairs
// for the current user. Cheap wrapper around matches.service — the personal
// /feed already covers the bucketed case.
export async function matchesRoute(app: FastifyInstance): Promise<void> {
  app.get('/matches', { preHandler: authGuard }, async (req) => {
    if (!req.accessToken) throw AppError.unauthenticated();
    const q = parseOrThrow(querySchema, req.query, 'query');
    const page = await listForUser(req.accessToken, q);
    return {
      items: page.items.map((m) => ({
        score: m.score,
        opportunity: m.opportunities ? serializeOpportunityTimes(m.opportunities) : null,
      })),
      next_cursor: page.next_cursor,
    };
  });
}
