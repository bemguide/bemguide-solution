import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow } from '../../utils/validation.js';
import { buildOpportunitiesByInterest } from '../../services/feed.service.js';
import { Constants } from '../../types/supabase.generated.js';

// Top opportunities for a single classified_interest enum value, across
// opportunities (future + undated) and opportunity_health. Scored by the
// caller's classified_interest overlap so user-aligned matches float up.
// `interest` is validated against the live DB enum (regenerated types
// keep this in sync automatically).
const querySchema = z.object({
  interest: z.enum(Constants.public.Enums.classified_interest),
  city: z.string().min(1).max(120).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});

export async function opportunitiesByInterestRoute(app: FastifyInstance): Promise<void> {
  app.get('/opportunities/by-interest', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const { interest, city, limit } = parseOrThrow(querySchema, req.query, 'query');
    return buildOpportunitiesByInterest(req.user.id, interest, city, limit);
  });
}
