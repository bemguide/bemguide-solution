import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, updateAttendanceSchema } from '../../utils/validation.js';
import { updateStatus } from '../../services/attendees.service.js';

export async function meAttendanceRoute(app: FastifyInstance): Promise<void> {
  app.patch<{ Params: { eventId: string } }>(
    '/me/attendance/:eventId',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user || !req.accessToken) throw AppError.unauthenticated();
      const { status } = parseOrThrow(updateAttendanceSchema, req.body, 'attendance');
      const attendee = await updateStatus(req.accessToken, req.user.id, req.params.eventId, status);
      return { attendee };
    },
  );
}
