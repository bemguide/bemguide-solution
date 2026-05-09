// PLACEHOLDER paths for the v2 feed endpoint. The backend is expected to
// produce three sections from the user's `event_matches` rows + the
// requesting user's profile (city window, identity pref, accessibility).

"use client";

import { apiFetch } from "./client";
import type { FeedSections, OpportunityCard } from "./types";

const FEED = "/feed"; // PLACEHOLDER
const OPPORTUNITY = (id: string) => `/opportunities/${id}`; // PLACEHOLDER
const ATTENDEES = (id: string) => `/opportunities/${id}/attendees`; // PLACEHOLDER

export function getFeed(opts?: { city?: string; signal?: AbortSignal }): Promise<FeedSections> {
  const qs = opts?.city ? `?city=${encodeURIComponent(opts.city)}` : "";
  return apiFetch<FeedSections>(`${FEED}${qs}`, { signal: opts?.signal });
}

export function getOpportunity(id: string, signal?: AbortSignal): Promise<OpportunityCard> {
  return apiFetch<OpportunityCard>(OPPORTUNITY(id), { signal });
}

export type AttendeeSummary = {
  count: number;
  /** Subset of accepted attendees who opted into public visibility. */
  names_visible: string[];
};

export function getOpportunityAttendees(
  id: string,
  signal?: AbortSignal,
): Promise<AttendeeSummary> {
  return apiFetch<AttendeeSummary>(ATTENDEES(id), { signal });
}
