import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { getForEvent } from '../../services/rooms.service.js';

export async function opportunityRoomRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/opportunities/:id/room',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const room = await getForEvent(req.user.id, req.params.id);
      // getForEvent returns null when the caller isn't an active attendee —
      // translate to 403 so we don't leak whether the room exists.
      // (404 is reserved for genuinely missing opportunities.)
      if (!room) throw AppError.forbidden('Not an attendee of this event', 'not_attendee');
      return room;
    },
  );
}
