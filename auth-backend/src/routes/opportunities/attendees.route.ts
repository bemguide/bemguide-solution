import type { FastifyInstance } from 'fastify';
import { adminGuard } from '../../plugins/admin-guard.js';
import { getPublicAttendeeStats, listByEvent } from '../../services/attendees.service.js';

export async function opportunityAttendeesRoute(app: FastifyInstance): Promise<void> {
  // PUBLIC. Returns count + opt-in display names. The contract (and the
  // public event page) need this without auth — same data RLS would
  // otherwise hide if we asked PostgREST directly.
  app.get<{ Params: { id: string } }>('/opportunities/:id/attendees', async (req) => {
    return getPublicAttendeeStats(req.params.id);
  });

  // Admin: full row list (used by organizer tools, not the public page).
  app.get<{ Params: { id: string } }>(
    '/admin/opportunities/:id/attendees',
    { preHandler: adminGuard },
    async (req) => {
      const attendees = await listByEvent(req.params.id);
      return { attendees };
    },
  );
}
