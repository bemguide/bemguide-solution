// Opportunity creation + list. Both endpoints are open to any authed
// user — `POST /opportunities` has no moderation gate (the backend stores
// the row directly and the recompute trigger immediately materialises
// event_matches against every matching profile).

"use client";

import { apiFetch } from "./client";
import type {
  AccessibilityFlag,
  AgeRange,
  IdentityPref,
  V2Opportunity,
  VeteranStatus,
} from "./types";

const OPPORTUNITIES = "/opportunities";

export type OpportunityCreate = {
  title: string; // 1–200
  short_description?: string | null; // ≤500
  description?: string | null; // ≤10000
  photo_url?: string | null;
  city: string;
  oblast?: string | null;
  address?: string | null;
  location_lat: number; // -90..90
  location_lng: number; // -180..180
  /** ISO with offset, e.g. `2026-05-15T18:00:00+03:00`. Backend strips tz. */
  start_at?: string | null;
  duration_min?: number | null;
  /** Free-form tags. Empty array = no targeting. */
  interests?: string[];
  accessibility_flags?: AccessibilityFlag[];
  price_uah?: number | null;
  organizer_contact?: string | null;
  /** [] = no preference. */
  target_age_range?: AgeRange[];
  target_identity_pref?: IdentityPref;
  /** [] = no preference. */
  target_veteran_status?: VeteranStatus[];
};

export function createOpportunity(body: OpportunityCreate): Promise<V2Opportunity> {
  return apiFetch<V2Opportunity>(OPPORTUNITIES, { method: "POST", body });
}

export type OpportunityListOpts = {
  city?: string;
  /** ISO range. */
  from?: string;
  to?: string;
  limit?: number; // ≤100
  cursor?: string;
  signal?: AbortSignal;
};

export type OpportunityListPage = {
  items: V2Opportunity[];
  next_cursor: string | null;
};

export function listOpportunities(opts: OpportunityListOpts = {}): Promise<OpportunityListPage> {
  const qs = new URLSearchParams();
  if (opts.city) qs.set("city", opts.city);
  if (opts.from) qs.set("from", opts.from);
  if (opts.to) qs.set("to", opts.to);
  if (opts.limit) qs.set("limit", String(opts.limit));
  if (opts.cursor) qs.set("cursor", opts.cursor);
  const tail = qs.toString();
  return apiFetch<OpportunityListPage>(
    tail ? `${OPPORTUNITIES}?${tail}` : OPPORTUNITIES,
    { signal: opts.signal },
  );
}
