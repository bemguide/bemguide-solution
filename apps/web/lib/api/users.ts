// PLACEHOLDER paths for the v2 user endpoints. Update once the backend team
// publishes the contract.

"use client";

import { apiFetch } from "./client";
import type {
  AccessibilityFlag,
  AgeRange,
  CompanyPreference,
  V2User,
  VeteranStatus,
} from "./types";

const ME = "/me"; // PLACEHOLDER

export type UserPatch = {
  city?: string;
  display_name?: string;
  show_name_publicly?: boolean;
  interests?: string[];
  availability?: string[];
  schedule_constraints?: string | null;
  company_preference?: CompanyPreference;
  accessibility_flags?: AccessibilityFlag[];
  triggers_to_avoid?: string[];
  veteran_status?: VeteranStatus | null;
  role_in_group?: string | null;
  age_range?: AgeRange | null;
  bio?: string | null;
};

export function getCurrentUser(signal?: AbortSignal): Promise<V2User> {
  return apiFetch<V2User>(ME, { signal });
}

export function updateCurrentUser(patch: UserPatch): Promise<V2User> {
  return apiFetch<V2User>(ME, { method: "PATCH", body: patch });
}
