// Feed + single-opportunity reads. Backend produces three buckets from
// event_matches × opportunities, sorted by score, decorated with
// match_score / attendee_count / names_visible / ai_reason.
//
// `/opportunities/:id` is *public* (softAuth on the backend) — no Bearer
// is required for the wife-mediated share flow, but if a token is in
// sessionStorage we still send it so the response gets `match_score`.

"use client";

import { apiFetch } from "./client";
import type { FeedSections, OpportunityCard } from "./types";

const FEED = "/feed";
const OPPORTUNITY = (id: string) => `/opportunities/${id}`;
const ATTENDEES = (id: string) => `/opportunities/${id}/attendees`;

export function getFeed(opts?: { city?: string; signal?: AbortSignal }): Promise<FeedSections> {
  const qs = opts?.city ? `?city=${encodeURIComponent(opts.city)}` : "";
  return apiFetch<FeedSections>(`${FEED}${qs}`, { signal: opts?.signal });
}

/**
 * Single opportunity. Public + softAuth — works without a token (returns
 * the bare opportunity), and decorated with `match_score` if a token is
 * present.
 */
export function getOpportunity(id: string, signal?: AbortSignal): Promise<OpportunityCard> {
  return apiFetch<OpportunityCard>(OPPORTUNITY(id), { signal });
}

export type AttendeeSummary = {
  /** joining + attended. Includes anonymous attendees that aren't in `names_visible`. */
  count: number;
  /** ≤12 names. Double opt-in: user.show_name_publicly AND attendee.show_name_publicly. */
  names_visible: string[];
};

export function getOpportunityAttendees(
  id: string,
  signal?: AbortSignal,
): Promise<AttendeeSummary> {
  return apiFetch<AttendeeSummary>(ATTENDEES(id), { signal });
}
