import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow } from '../../utils/validation.js';
import { rsvpToOpportunity } from '../../services/rsvp.service.js';
import { setShowNamePublicly } from '../../services/attendees.service.js';

const rsvpBodySchema = z.object({
  response: z.enum(['accepted', 'declined']),
  invitation_id: z.string().uuid().optional(),
  display_name: z.string().min(1).max(120).nullish(),
  show_name_publicly: z.boolean().optional(),
});

const showNameBodySchema = z.object({
  show: z.boolean(),
});

export async function opportunityRsvpRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/opportunities/:id/rsvp',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user || !req.accessToken) throw AppError.unauthenticated();
      const body = parseOrThrow(rsvpBodySchema, req.body, 'rsvp');
      return rsvpToOpportunity(req.accessToken, req.user.id, req.params.id, body);
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/opportunities/:id/attendee/show-name',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const { show } = parseOrThrow(showNameBodySchema, req.body, 'show-name');
      return setShowNamePublicly(req.user.id, req.params.id, show);
    },
  );
}
