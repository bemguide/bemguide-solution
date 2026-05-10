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
  FeedResponse,
  FilteredFeedResponse,
  OpportunityCard,
  ProgramsFeedResponse,
} from "./types";

const FEED = "/feed";
const OPPORTUNITY = (id: string) => `/opportunities/${id}`;
const ATTENDEES = (id: string) => `/opportunities/${id}/attendees`;

/**
 * `GET /feed` returns one of three shapes depending on `filter`:
 *   - omitted        → `FeedResponse` (today_tomorrow / this_week / try_new)
 *   - `health` |
 *     `discounts`    → `FilteredFeedResponse` (mixed `FeedItem[]`)
 *   - `programs`     → `ProgramsFeedResponse` (program cards + hotlines)
 *
 * Callers should use the dedicated `getProgramsFeed()` for the third
 * shape; `getFeed()` overload-narrows the first two.
 */
export function getFeed(opts?: {
  city?: string;
  signal?: AbortSignal;
}): Promise<FeedResponse>;
export function getFeed(opts: {
  filter: "health" | "discounts";
  city?: string;
  signal?: AbortSignal;
}): Promise<FilteredFeedResponse>;
export function getFeed(opts?: {
  filter?: "health" | "discounts";
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
 * `GET /feed?filter=programs` — государственные программы для ветеранов.
 *
 * Server-side scoping (UI does NOT need to re-filter):
 *   - eligibility:  `target_veteran_status && [user.veteran_status]`
 *                   (when `user.veteran_status` is null, EVERY program returns)
 *   - city:         state-wide rows (`city IS NULL`) always; city-specific
 *                   rows only when they match the resolved city.
 *
 * Items arrive sorted by `program_category ASC, title ASC`. Hotlines are
 * always present, sorted by `display_order ASC`.
 */
export function getProgramsFeed(opts?: {
  city?: string;
  signal?: AbortSignal;
}): Promise<ProgramsFeedResponse> {
  const params = new URLSearchParams({ filter: "programs" });
  if (opts?.city) params.set("city", opts.city);
  return apiFetch(`${FEED}?${params.toString()}`, { signal: opts?.signal });
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
