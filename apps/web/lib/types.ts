// Shared TS types used by web components. Mirrors the union of fields available
// when a server component reads from Supabase + computes derived signals.

import type { AccessibilityFlag, IdentityPref, InterestCategory } from "@poruch/shared";

export type EventForDisplay = {
  id: string;
  slug: string;
  title: string;
  short_description: string | null;
  description?: string | null;
  photo_url: string | null;
  city: string;
  oblast?: string | null;
  address: string | null;
  location_lat?: number | null;
  location_lng?: number | null;
  start_at: string; // ISO with Europe/Kyiv offset
  duration_min: number;
  categories: InterestCategory[];
  identity_tag: IdentityPref;
  accessibility_flags: AccessibilityFlag[];
  honest_absences: string[] | null;
  price_uah: number;
  organizer_contact?: string | null;
  // computed / joined
  going_count?: number;
  names_visible?: string[];
  distance_km?: number | null;
  ai_reason?: string;
};
