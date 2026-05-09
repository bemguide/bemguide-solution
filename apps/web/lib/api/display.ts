// Adapter from the v2 wire shape to the EventForDisplay shape that the
// existing components (FeaturedEventCard / CompactEventCard / WhoIsGoing /
// AccessibilityStrip) take. Keeps the components untouched while we
// migrate the data plane underneath them.
//
// One notable change: v2 doesn't ship `slug` (only `id`), and we route
// off `id` everywhere. The adapter therefore sets `slug = id`.
// `honest_absences` was a v1 concept and is not modelled in v2 — null.

import type {
  AccessibilityFlag,
  IdentityPref,
  InterestCategory,
} from "@poruch/shared";
import type { EventForDisplay } from "@/lib/types";
import type { OpportunityCard, V2Opportunity } from "./types";

type SourceOpportunity =
  | (V2Opportunity & Partial<Pick<OpportunityCard, "match_score" | "ai_reason" | "attendee_count" | "names_visible" | "distance_km">>)
  | OpportunityCard;

export function opportunityToDisplay(o: SourceOpportunity): EventForDisplay {
  return {
    id: o.id,
    slug: o.id, // route everything off the UUID; no separate slug column in v2.
    title: o.title,
    short_description: o.short_description,
    description: o.description ?? null,
    photo_url: o.photo_url ?? null,
    city: o.city,
    oblast: o.oblast ?? null,
    address: o.address ?? null,
    location_lat: o.location_lat ?? null,
    location_lng: o.location_lng ?? null,
    // EventForDisplay requires non-null start_at; v2 allows null (always-on
    // opportunities). The components never render null so this only matters
    // for free-form events that the feed already filters out.
    start_at: o.start_at ?? "",
    duration_min: o.duration_min ?? 60,
    // Backend stores interests as free-form text[]. Cast for component
    // typing — the components only use them for rendering.
    categories: (o.interests ?? []) as unknown as InterestCategory[],
    identity_tag: (o.target_identity_pref ?? "any") as IdentityPref,
    accessibility_flags: (o.accessibility_flags ?? []) as AccessibilityFlag[],
    honest_absences: null,
    price_uah: o.price_uah ?? 0,
    organizer_contact: o.organizer_contact ?? null,
    going_count: o.attendee_count,
    names_visible: o.names_visible,
    distance_km: o.distance_km,
    ai_reason: o.ai_reason,
  };
}
