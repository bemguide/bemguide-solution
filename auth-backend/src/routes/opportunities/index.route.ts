import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { adminGuard } from '../../plugins/admin-guard.js';
import { AppError } from '../../utils/errors.js';
import {
  parseOrThrow,
  createOpportunitySchema,
  listOpportunitiesQuerySchema,
} from '../../utils/validation.js';
import { create, listForCity } from '../../services/opportunities.service.js';
import { serializeOpportunityTimes } from '../../utils/time.js';

export async function opportunitiesIndexRoute(app: FastifyInstance): Promise<void> {
  // Public list filtered by city + window. Cursor-paginated by (start_at, id).
  // The /feed endpoint is the personalised path; this is the unfiltered admin/
  // discovery path that the public event-page lookup uses.
  app.get('/opportunities', async (req) => {
    const q = parseOrThrow(listOpportunitiesQuerySchema, req.query, 'query');
    const page = await listForCity(q);
    return {
      ...page,
      items: page.items.map(serializeOpportunityTimes),
    };
  });

  // Authed create — veteran-submitted events. Schema has no `status` column,
  // so this is "publish on submit" until moderation lands. The contract's
  // open question #7 acknowledges this gap.
  app.post('/opportunities', { preHandler: authGuard }, async (req, reply) => {
    if (!req.user) throw AppError.unauthenticated();
    const input = parseOrThrow(createOpportunitySchema, req.body, 'opportunity');
    const opportunity = await create(input);
    reply.code(201);
    return serializeOpportunityTimes(opportunity);
  });

  // Admin alias for create — kept for parity with /events/* historical surface.
  // (Both write to the same table; the difference is whether we trust the
  // requester to skip moderation. Until moderation exists, both paths behave
  // identically.)
  app.post('/admin/opportunities', { preHandler: adminGuard }, async (req, reply) => {
    const input = parseOrThrow(createOpportunitySchema, req.body, 'opportunity');
    const opportunity = await create(input);
    reply.code(201);
    return serializeOpportunityTimes(opportunity);
  });
}
