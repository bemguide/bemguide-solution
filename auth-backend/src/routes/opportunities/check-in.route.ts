import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { supabaseAdmin } from '../../config/supabase.js';
import { verifyCheckInToken } from '../../services/session.service.js';
import { updateStatus } from '../../services/attendees.service.js';
import { parseOrThrow } from '../../utils/validation.js';

// POST /opportunities/:id/check-in
//
// Counterpart to GET /opportunities/:id/check-in-token. Any authenticated
// user can act as scanner; the verification trust comes from the signed QR
// token, not from the scanner's role. Scanner presents:
//   * Bearer = scanner's session JWT
//   * Body { token } = the attendee's QR JWT (audience='check-in', event_id
//     bound, sub=user_id)
//
// Why no organizer gate: opportunities.created_by is unpopulated for the
// existing inventory, so a strict admin/organizer check 403s every real
// scan. The QR token itself already binds (signature, audience='check-in',
// event_id, short TTL, mintable only for attendees with status joining/
// attended), and step 2 below pins the URL :id to the token's event_id, so
// a stolen token can't be redeemed at a different event. If venue-side
// abuse becomes a concern, re-add the gate behind a `created_by IS NOT NULL`
// fallback once new opportunities consistently track their organizer.
//
// Idempotent: a second call with the same token after status='attended' is
// a 200 no-op. Any failure mode of the QR token (signature, expiry, audience,
// event mismatch, missing/stale attendee row) collapses to 401 — the scanner
// just needs to know "the QR didn't work, try again."

const checkInBodySchema = z.object({ token: z.string().min(1) });

export async function opportunityCheckInRoute(app: FastifyInstance): Promise<void> {
  app.post<{ Params: { id: string } }>(
    '/opportunities/:id/check-in',
    { preHandler: authGuard },
    async (req) => {
      if (!req.user) throw AppError.unauthenticated();
      const eventId = req.params.id;
      const { token } = parseOrThrow(checkInBodySchema, req.body, 'body');

      // 1. QR verify. Throws AppError.expired/unauthenticated → 401.
      const payload = await verifyCheckInToken(token);

      // 2. URL :id must match token's event_id (cross-event substitution
      //    defense — a leaked token for event A can't be used at event B).
      if (payload.event_id !== eventId) {
        throw AppError.unauthenticated('Invalid check-in token (event mismatch)');
      }

      // 3. Look up attendee. Missing row or non-checkable status → 401, mirrors
      //    the gate in check-in-token.route.ts:32-38 that only mints tokens
      //    for joining/attended.
      const { data: attendee, error: attErr } = await supabaseAdmin
        .from('event_attendees')
        .select('*')
        .eq('event_id', eventId)
        .eq('user_id', payload.user_id)
        .maybeSingle();
      if (attErr) throw AppError.upstream('Failed to load attendee', attErr.message);
      if (!attendee) throw AppError.unauthenticated('Invalid check-in token (no attendee)');

      // 4. Idempotent transition. joining → attended. attended is a no-op.
      let updated = attendee;
      if (attendee.status === 'joining') {
        updated = await updateStatus(payload.user_id, eventId, 'attended');
      } else if (attendee.status !== 'attended') {
        // 'left' or 'no_show' — token shouldn't have been issuable, treat as
        // invalid rather than 4xx-leaking the row's state.
        throw AppError.unauthenticated(`Invalid check-in token (status: ${attendee.status})`);
      }

      // 5. Optional user payload for scanner UX (greeting, name, etc.). Best-
      //    effort — if the read fails for some reason we still return ok=true.
      const { data: user } = await supabaseAdmin
        .from('users')
        .select('id, display_name, show_name_publicly')
        .eq('id', payload.user_id)
        .maybeSingle();

      return { ok: true, attendee: updated, user: user ?? undefined };
    },
  );
}
