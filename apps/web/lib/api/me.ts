// /me/* endpoints beyond GET/PATCH /me itself. Used by:
//   - the "upcoming" widget on the profile screen
//   - the matches debug view
//   - check-in / no-show flows on the day-of

"use client";

import { apiFetch } from "./client";
import type {
  AttendeeStatus,
  V2EventAttendee,
  V2EventInvitation,
  V2Opportunity,
  V2EventMatch,
} from "./types";

const ME_MATCHES = "/me/matches";
const MATCHES_SHORT = "/matches";
const ME_INVITATIONS = "/me/invitations";
const ME_ATTENDANCE = (eventId: string) => `/me/attendance/${eventId}`;
const ME_UPCOMING = "/me/upcoming";

// ---------------------------------------------------------------
// Matches
// ---------------------------------------------------------------

export type MatchPage = {
  items: { score: number; opportunity: V2Opportunity }[];
  next_cursor: string | null;
};

export function getMyMatches(opts: { limit?: number; cursor?: string } = {}): Promise<MatchPage> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const tail = qs.toString();
  return apiFetch<MatchPage>(tail ? `${ME_MATCHES}?${tail}` : ME_MATCHES);
}

/** Short alias matching the original contract. Returns same shape as /me/matches. */
export function getMatches(opts: { limit?: number; cursor?: string } = {}): Promise<MatchPage> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const tail = qs.toString();
  return apiFetch<MatchPage>(tail ? `${MATCHES_SHORT}?${tail}` : MATCHES_SHORT);
}

// ---------------------------------------------------------------
// Invitations (legacy path — combined RSVP supersedes for happy path)
// ---------------------------------------------------------------

export type InvitationListPage = {
  items: V2EventInvitation[];
  next_cursor: string | null;
};

export function getMyInvitations(opts: {
  limit?: number;
  cursor?: string;
} = {}): Promise<InvitationListPage> {
  const qs = new URLSearchParams();
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const tail = qs.toString();
  return apiFetch<InvitationListPage>(tail ? `${ME_INVITATIONS}?${tail}` : ME_INVITATIONS);
}

export type InvitationPatch = { response: "accepted" | "declined" };

export function patchInvitation(
  invitationId: string,
  body: InvitationPatch,
): Promise<V2EventInvitation> {
  return apiFetch<V2EventInvitation>(`${ME_INVITATIONS}/${invitationId}`, {
    method: "PATCH",
    body,
  });
}

// ---------------------------------------------------------------
// Attendance — used during/after the event for check-in & survey
// ---------------------------------------------------------------

/** Allowed transitions: joining → attended | no_show | left. */
export type AttendancePatch = { status: Exclude<AttendeeStatus, "joining"> };

export function updateAttendance(
  eventId: string,
  body: AttendancePatch,
): Promise<V2EventAttendee> {
  return apiFetch<V2EventAttendee>(ME_ATTENDANCE(eventId), {
    method: "PATCH",
    body,
  });
}

// ---------------------------------------------------------------
// Upcoming — populates "наступне у тебе" on the profile screen
// ---------------------------------------------------------------

export type UpcomingItem = {
  attendee: V2EventAttendee;
  opportunity: V2Opportunity;
};

export type UpcomingResponse = { items: UpcomingItem[] };

export function getUpcoming(): Promise<UpcomingResponse> {
  return apiFetch<UpcomingResponse>(ME_UPCOMING);
}

// Re-export V2EventMatch so callers don't have to import it from elsewhere.
export type { V2EventMatch };
