import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../plugins/auth-guard.js';
import { AppError } from '../utils/errors.js';
import { parseOrThrow } from '../utils/validation.js';
import { buildFeed, buildFilteredFeed } from '../services/feed.service.js';

// `filter` switches the response shape:
//   absent           → 3 time buckets (default), opportunities only
//   'health'         → flat list across opportunities + opportunity_health,
//                      scoped to medical/therapy/psychology tags
//                      (recovery, psychological_support, medical_care,
//                      art_therapy, equine_therapy)
//   'rehabilitation' → flat list scoped to clinical rehabilitation tag
//                      (split out from 'health' so it surfaces as its
//                      own user-facing category)
//   'discounts'      → flat list across both tables, scoped to discount_promotions
const querySchema = z.object({
  city: z.string().min(1).max(120).optional(),
  filter: z.enum(['health', 'rehabilitation', 'discounts']).optional(),
});

export async function feedRoute(app: FastifyInstance): Promise<void> {
  app.get('/feed', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const { city, filter } = parseOrThrow(querySchema, req.query, 'query');
    if (filter) return buildFilteredFeed(req.user.id, filter, city);
    return buildFeed(req.user.id, city);
  });
}
