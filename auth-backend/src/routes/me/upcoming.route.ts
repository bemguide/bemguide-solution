import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { listUpcomingForUser } from '../../services/attendees.service.js';
import { serializeOpportunityTimes } from '../../utils/time.js';

export async function meUpcomingRoute(app: FastifyInstance): Promise<void> {
  app.get('/me/upcoming', { preHandler: authGuard }, async (req) => {
    if (!req.user || !req.accessToken) throw AppError.unauthenticated();
    const items = await listUpcomingForUser(req.accessToken, req.user.id);
    return {
      items: items.map((it) => ({
        attendee: it.attendee,
        opportunity: serializeOpportunityTimes(it.opportunity),
      })),
    };
  });
}
