// PLACEHOLDER paths for the RSVP / invitation flow. The backend writes the
// `event_invitations.response` and (on accept) creates the matching
// `event_attendees` row + queues `event_rooms` provisioning via its triggers.

"use client";

import { apiFetch } from "./client";
import type { AttendeeStatus, V2EventAttendee, V2EventInvitation, V2EventRoom } from "./types";

const RSVP = (eventId: string) => `/opportunities/${eventId}/rsvp`; // PLACEHOLDER
const ROOM = (eventId: string) => `/opportunities/${eventId}/room`; // PLACEHOLDER
const ATTENDEE_NAME = (eventId: string) => `/opportunities/${eventId}/attendee/show-name`; // PLACEHOLDER

export type RsvpRequest = {
  response: "accepted" | "declined";
  /** Optional client-known invitation id — backend can also derive from (event,user). */
  invitation_id?: string;
  /** Capture display_name on first accept if profile is missing one. */
  display_name?: string;
  /** Per-event opt-in for public name visibility. */
  show_name_publicly?: boolean;
};

export type RsvpResponse = {
  invitation: V2EventInvitation;
  attendee: V2EventAttendee | null;
  /** Provisioned chat room (telegram link etc.) — null until worker fills it. */
  room: V2EventRoom | null;
};

export function rsvp(eventId: string, body: RsvpRequest): Promise<RsvpResponse> {
  return apiFetch<RsvpResponse>(RSVP(eventId), { method: "POST", body });
}

export function getRoom(eventId: string, signal?: AbortSignal): Promise<V2EventRoom | null> {
  return apiFetch<V2EventRoom | null>(ROOM(eventId), { signal });
}

export function setShowNamePublicly(
  eventId: string,
  show: boolean,
): Promise<{ status: AttendeeStatus; show_name_publicly: boolean }> {
  return apiFetch(ATTENDEE_NAME(eventId), { method: "PATCH", body: { show } });
}
