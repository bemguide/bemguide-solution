// User endpoints. PATCH /me triggers the backend's match-recompute — any
// change to {city, interests, accessibility_flags, age_range,
// company_preference, veteran_status} repopulates event_matches for the
// caller, so the next /feed call returns a freshly-personalised list.

"use client";

import { apiFetch } from "./client";
import type {
  AccessibilityFlag,
  AgeRange,
  CompanyPreference,
  V2User,
  VeteranStatus,
} from "./types";

const ME = "/me";

export type UserPatch = {
  city?: string | null;
  display_name?: string | null;
  show_name_publicly?: boolean;
  /** ≤32 items, ≤80 chars each. Free-form (no enum gate). */
  interests?: string[];
  /** ≤32 items. */
  availability?: string[];
  /** ≤2000 chars. */
  schedule_constraints?: string | null;
  company_preference?: CompanyPreference;
  accessibility_flags?: AccessibilityFlag[];
  /** ≤32 items. */
  triggers_to_avoid?: string[];
  veteran_status?: VeteranStatus | null;
  role_in_group?: string | null;
  age_range?: AgeRange | null;
  /** ≤500 chars. */
  bio?: string | null;
};

export function getCurrentUser(signal?: AbortSignal): Promise<V2User> {
  return apiFetch<V2User>(ME, { signal });
}

export function updateCurrentUser(patch: UserPatch): Promise<V2User> {
  return apiFetch<V2User>(ME, { method: "PATCH", body: patch });
}
