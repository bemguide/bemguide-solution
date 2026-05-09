import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../../plugins/admin-guard.js';
import { softAuth } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, updateOpportunitySchema } from '../../utils/validation.js';
import { archive, decorateForCard, getById, update } from '../../services/opportunities.service.js';
import { serializeOpportunityTimes } from '../../utils/time.js';

interface IdParams {
  id: string;
}

export async function opportunityByIdRoute(app: FastifyInstance): Promise<void> {
  // PUBLIC. Михайло flow: deep-link from a Viber share, no auth header.
  // When authed (softAuth populates req.user), decorate with match_score etc.
  app.get<{ Params: IdParams }>('/opportunities/:id', { preHandler: softAuth }, async (req) => {
    const opportunity = await getById(req.params.id);
    if (!opportunity) {
      throw AppError.notFound('Opportunity not found', 'opportunity_not_found');
    }
    const decoration = await decorateForCard(opportunity.id, req.user?.id ?? null);
    const card = {
      ...serializeOpportunityTimes(opportunity),
      // match_score is omitted (not undefined) for unauthed callers per contract.
      ...(decoration.match_score !== undefined ? { match_score: decoration.match_score } : {}),
      attendee_count: decoration.attendee_count,
      names_visible: decoration.names_visible,
      distance_km: null as number | null,
    };
    return card;
  });

  app.patch<{ Params: IdParams }>('/opportunities/:id', { preHandler: adminGuard }, async (req) => {
    const patch = parseOrThrow(updateOpportunitySchema, req.body, 'opportunity patch');
    const opportunity = await update(req.params.id, patch);
    return serializeOpportunityTimes(opportunity);
  });

  app.delete<{ Params: IdParams }>(
    '/opportunities/:id',
    { preHandler: adminGuard },
    async (req, reply) => {
      await archive(req.params.id);
      reply.code(204);
      return null;
    },
  );
}
