import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow } from '../../utils/validation.js';
import { buildHealthDiscoveryForUser } from '../../services/feed.service.js';

// Personalized health discovery. Mirrors /feed?filter=health on the
// dual-table query (opportunities + opportunity_health, REHABILITATION
// excluded), but narrows the include set to the caller's onboarded health
// interests — fallback to the full HEALTH_INTEREST_TAGS set when the user
// has no health tags in classified_interest yet.
const querySchema = z.object({
  city: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(60).optional(),
});

export async function opportunitiesHealthRoute(app: FastifyInstance): Promise<void> {
  app.get('/opportunities/health', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const { city, limit } = parseOrThrow(querySchema, req.query, 'query');
    return buildHealthDiscoveryForUser(req.user.id, city, limit);
  });
}
