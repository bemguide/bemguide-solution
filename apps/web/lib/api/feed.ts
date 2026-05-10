// Feed + single-opportunity reads.
//
// `/feed` returns one of two shapes depending on the `filter` query param:
//   - default → `FeedResponse` (today_tomorrow / this_week / try_new buckets,
//     events only)
//   - `?filter=health` or `?filter=discounts` → `FilteredFeedResponse`
//     (flat `items` of mixed `opportunity` + `opportunity_health`)
//
// `/opportunities/:id` is *public* (softAuth on the backend) — no Bearer
// is required for the wife-mediated share flow, but if a token is in
// sessionStorage we still send it so the response gets `match_score`.

"use client";

import { apiFetch } from "./client";
import type {
  FeedFilter,
  FeedResponse,
  FilteredFeedResponse,
  OpportunityCard,
} from "./types";

const FEED = "/feed";
const OPPORTUNITY = (id: string) => `/opportunities/${id}`;
const ATTENDEES = (id: string) => `/opportunities/${id}/attendees`;

// Overloaded: pass `filter` and you get the filtered shape;
// omit it and you get the default 3-bucket shape. The two paths
// hit the same `/feed` route — the param is what flips the
// response shape on the backend.
export function getFeed(opts?: {
  city?: string;
  signal?: AbortSignal;
}): Promise<FeedResponse>;
export function getFeed(opts: {
  filter: FeedFilter;
  city?: string;
  signal?: AbortSignal;
}): Promise<FilteredFeedResponse>;
export function getFeed(opts?: {
  filter?: FeedFilter;
  city?: string;
  signal?: AbortSignal;
}): Promise<FeedResponse | FilteredFeedResponse> {
  const params = new URLSearchParams();
  if (opts?.filter) params.set("filter", opts.filter);
  if (opts?.city) params.set("city", opts.city);
  const tail = params.toString();
  return apiFetch(tail ? `${FEED}?${tail}` : FEED, { signal: opts?.signal });
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
