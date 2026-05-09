import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { mintCheckInToken } from '../../services/session.service.js';

// GET /opportunities/:id/check-in-token
//
// Returns a short-lived JWT the user shows (typically as a QR code) at the
// venue. Organizer's scanner will verify via the matching verify endpoint
// (not yet wired) — until then the token is opaque to the frontend; just pass
// it through to whatever scanner UI renders the QR.
//
// 403 not_attendee if the user has no event_attendees row for this event,
// or has explicitly opted out (status='left' / 'no_show'). 'attended' is
// allowed so the endpoint stays idempotent — re-fetching after a successful
// scan is harmless.
export async function opportunityCheckInTokenRoute(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string } }>(
    '/opportunities/:id/check-in-token',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const eventId = req.params.id;

      const { data: attendee, error: attErr } = await supabaseAdmin
        .from('event_attendees')
        .select('status')
        .eq('event_id', eventId)
        .eq('user_id', req.user.id)
        .maybeSingle();
      if (attErr) throw AppError.upstream('Failed to verify attendance', attErr.message);
      if (!attendee) {
        throw AppError.forbidden('Not an attendee of this event', 'not_attendee');
      }
      if (attendee.status !== 'joining' && attendee.status !== 'attended') {
        throw AppError.forbidden(`Cannot check in (status: ${attendee.status})`, 'not_attendee');
      }

      const minted = await mintCheckInToken(req.user.id, eventId);
      return { token: minted.token, expires_at: minted.expires_at };
    },
  );
}
