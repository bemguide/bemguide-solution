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
import type { V2EventAttendee, V2User } from "./types";

export type CheckInToken = {
  token: string;
  expires_at?: string;
};

const TOKEN = (eventId: string) => `/opportunities/${eventId}/check-in-token`;
const VERIFY = (eventId: string) => `/opportunities/${eventId}/check-in`;

export function getCheckInToken(eventId: string): Promise<CheckInToken> {
  return apiFetch<CheckInToken>(TOKEN(eventId));
}

// ---------------------------------------------------------------
// Verify (organizer side) — proposed backend contract
// ---------------------------------------------------------------
//
// `POST /opportunities/:id/check-in`
// Auth: Bearer required, must be admin OR the event creator
//       (depends on the eventual ownership model — for now, admin only
//        per existing PATCH/DELETE policy).
// Body: { token: string }
// 200: { ok: true, attendee, user? } — `user` optional, lets us
//      render the attendee's display name in the result toast.
// 401: { error: "unauthorized" }       — bad/expired token
// 403: { error: "forbidden" }          — not admin / not organizer
// 404: { error: "not_found" }          — endpoint not implemented yet
//
// Frontend guards 404 → shows "Бекенд поки що не приймає check-in",
// so the scanner UI ships before the backend route lands.

export type CheckInVerifyResult = {
  ok: true;
  attendee: V2EventAttendee;
  user?: Pick<V2User, "id" | "display_name" | "show_name_publicly">;
};

export function verifyCheckIn(
  eventId: string,
  token: string,
): Promise<CheckInVerifyResult> {
  return apiFetch<CheckInVerifyResult>(VERIFY(eventId), {
    method: "POST",
    body: { token },
  });
}
