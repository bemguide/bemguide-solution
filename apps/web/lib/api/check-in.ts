// Backend-issued attendance token for the event-detail QR.
//
// Expected backend contract (open question for the backend team):
//
//   GET /opportunities/:id/check-in-token
//   Auth: bearer required, RLS limits to attendees (same shape as /room).
//   200 → { token: string, expires_at?: string }
//      Token is whatever the organizer's scanner can verify — a short JWT
//      signed with the same SESSION_JWT_SECRET, an HMAC of {event_id,
//      user_id, exp}, or an opaque DB-backed key. The frontend only
//      needs a deterministic string to encode in the QR.
//   403 → not_attendee (we never call this branch — the page only shows
//          the QR after `/room` succeeds, which already gates on RLS)
//   404 → not implemented yet — we fall back to a client-side payload
//          so the demo flow doesn't break while the endpoint is in
//          flight. Replace with a 503 once it lands so we can drop the
//          fallback path.

"use client";

import { apiFetch } from "./client";

export type CheckInToken = {
  token: string;
  expires_at?: string;
};

const PATH = (eventId: string) => `/opportunities/${eventId}/check-in-token`;

export function getCheckInToken(eventId: string): Promise<CheckInToken> {
  return apiFetch<CheckInToken>(PATH(eventId));
}
