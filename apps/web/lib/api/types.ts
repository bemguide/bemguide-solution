// v2 API types. Mirrors what `auth-backend` returns (and `docs/SCHEMA.md`).
// Update both files together when the schema shifts.
//
// Wire conventions worth remembering:
//   - Timestamps: ISO `…Z` for createdAt/updatedAt; `opportunities.start_at`
//     and `ends_at` come back with explicit `+03:00` (Europe/Kyiv).
//   - Decline is sticky: once `event_invitations.response = 'declined'`,
//     POST /opportunities/:id/rsvp can't flip it back to 'accepted'.
//   - `OpportunityCard.distance_km` is always `null` on the wire; the
//     frontend computes it from the user's geolocation when available.

// ---------------------------------------------------------------
// Enums
// ---------------------------------------------------------------

export type AccessibilityFlag =
  | "barrier_free"
  | "no_stairs"
  | "quiet_room"
  | "no_alcohol"
  | "sign_language"
  | "audio_described"
  | "sensory_friendly"
  | "parking_disabled"
  | "service_animal_ok";

export type VeteranStatus =
  // Backend's `veteran_status` enum (auth-backend/SCHEMA.md). Semantic
  // labels rather than UVBD-N codes — keeps onboarding language plain
  // ("Маю посвідчення УБД") and matches what the backend stores verbatim.
  | "ubd"
  | "volunteer"
  | "active_duty"
  | "veteran"
  | "war_disabled"
  | "former_pow"
  | "family_of_fallen"
  | "family_of_missing"
  | "family_of_veteran"
  | "civilian_affected"
  | "in_process"
  | "no_docs";

export type CompanyPreference = "with_partner" | "women_only" | "mixed" | "close_ones" | "any";

export type AgeRange = "18_24" | "25_34" | "35_44" | "45_54" | "55_64" | "65_plus";

export type IdentityPref =
  | "any"
  | "women_only"
  | "men_only"
  | "mixed_with_women_emphasis"
  | "family_friendly";

/**
 * Backend's controlled-vocabulary tag set, populated by the Gemini classifier
 * on opportunity inserts/updates and on user onboarding answers. Use these
 * (not the legacy free-form `interests: string[]`) for matching, filtering,
 * and chips on cards.
 */
export type ClassifiedInterest =
  // Physical / movement
  | "physical_sport"
  | "adaptive_sport"
  | "equine_therapy"
  | "outdoor_recreation"
  // Creative / cultural
  | "art_therapy"
  | "music"
  | "creative_workshop"
  | "cultural_event"
  // Health / therapy
  | "rehabilitation"
  | "recovery"
  | "psychological_support"
  | "medical_care"
  // Practical / life
  | "legal_aid"
  | "education"
  | "career_development"
  | "employment"
  | "financial_aid"
  | "discount_promotions"
  // Social
  | "support_group"
  | "community_meetup"
  | "family_support"
  | "women_support";

/** Narrow enum used only on `opportunity_health.interests`. */
export type HealthInterest = "rehabilitation" | "recovery" | "healing";

export type InvitationDeliveryStatus = "pending" | "sent" | "failed" | "cancelled";
export type InvitationResponse = "accepted" | "declined" | "ignored";
export type AttendeeStatus = "joining" | "attended" | "no_show" | "left";

// ---------------------------------------------------------------
// Entities
// ---------------------------------------------------------------

export type V2User = {
  id: string;
  email: string;
  city: string | null;
  display_name: string | null;
  show_name_publicly: boolean;
  interests: string[];
  availability: string[];
  schedule_constraints: string | null;
  company_preference: CompanyPreference;
  accessibility_flags: AccessibilityFlag[];
  triggers_to_avoid: string[];
  veteran_status: VeteranStatus | null;
  role_in_group: string | null;
  age_range: AgeRange | null;
  bio: string | null;
  telegram_user_id: number | null;
  created_at: string;
  updated_at: string;
};

export type V2Opportunity = {
  id: string;
  title: string;
  short_description: string | null;
  description: string | null;
  photo_url: string | null;
  city: string;
  oblast: string | null;
  address: string | null;
  location_lat: number;
  location_lng: number;
  /** ISO timestamp with `+03:00` offset (Europe/Kyiv). */
  start_at: string | null;
  duration_min: number | null;
  /** Generated column = start_at + duration_min. Read-only. Same offset. */
  ends_at: string | null;
  /** Legacy free-form interest tags — kept for audit. Use
   *  `classified_interest` for any matching/filtering/UX. */
  interests: string[];
  /** Controlled-vocabulary tags assigned by the backend's classifier. */
  classified_interest: ClassifiedInterest[];
  accessibility_flags: AccessibilityFlag[];
  price_uah: number | null;
  organizer_contact: string | null;
  /** [] = no preference. Multi-select. */
  target_age_range: AgeRange[];
  target_identity_pref: IdentityPref;
  /** [] = no preference. Multi-select. */
  target_veteran_status: VeteranStatus[];
  /**
   * The user who created/organizes the event. Authorises organizer-only
   * routes — most importantly `POST /opportunities/:id/check-in` (the QR
   * scanner). `null` for ~146 legacy rows that pre-date migration 0013;
   * those events can't be scanner-managed unless someone backfills the
   * column manually.
   */
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Static health resource (rehab clinic, support center, etc.) — sibling
 * table to `opportunities`. Always-on, no `start_at`/`ends_at`/`duration_min`
 * and no RSVP. Surfaces only via `GET /feed?filter=health`.
 */
export type V2OpportunityHealth = {
  id: string;
  /** Discriminator on the row itself; only one value today, kept for
   *  future expansion (e.g. `mobile_clinic`). */
  type: "static";
  title: string;
  short_description: string | null;
  description: string | null;
  photo_url: string | null;
  city: string;
  oblast: string | null;
  address: string | null;
  location_lat: number;
  location_lng: number;
  /** Narrow vocabulary scoped to the health domain. */
  interests: HealthInterest[];
  /** Same global classifier output as opportunities. */
  classified_interest: ClassifiedInterest[];
  accessibility_flags: AccessibilityFlag[];
  target_age_range: AgeRange[];
  target_identity_pref: IdentityPref;
  target_veteran_status: VeteranStatus[];
  price_uah: number | null;
  organizer_contact: string | null;
  /** Aggregate visit counter, not per-user. Increments via a future
   *  POST endpoint we don't consume yet. */
  visit_count: number;
  created_at: string;
  updated_at: string;
};

export type V2EventMatch = {
  event_id: string;
  user_id: string;
  score: number;
  computed_at: string;
};

export type V2EventInvitation = {
  id: string;
  event_id: string;
  user_id: string;
  score_at_invite: number | null;
  channel: "telegram" | "email" | "inapp";
  channel_external_id: string | null;
  scheduled_for: string | null;
  sent_at: string | null;
  delivery_status: InvitationDeliveryStatus;
  failure_reason: string | null;
  retry_count: number;
  responded_at: string | null;
  response: InvitationResponse | null;
  created_at: string;
};

export type V2EventAttendee = {
  event_id: string;
  user_id: string;
  invitation_id: string | null;
  status: AttendeeStatus;
  show_name_publicly: boolean;
  joined_at: string;
};

export type V2EventRoom = {
  event_id: string;
  chat_provider: "telegram" | "matrix" | null;
  chat_external_id: string | null;
  chat_invite_url: string | null;
  chat_created_at: string | null;
  created_at: string;
  updated_at: string;
};

// ---------------------------------------------------------------
// Convenience composites
// ---------------------------------------------------------------

/** Opportunity decorated with derived/aggregated fields the feed needs. */
export type OpportunityCard = V2Opportunity & {
  /** Personalisation: omitted (not null) when the request was unauthed. */
  match_score?: number;
  /** Backend-computed via Gemini; empty string when GEMINI_API_KEY unset. */
  ai_reason?: string;
  /** Count of joining + attended event_attendees rows. */
  attendee_count?: number;
  /** ≤12 opt-in display_names (double opt-in: user.show_name_publicly AND attendee.show_name_publicly). */
  names_visible?: string[];
  /** Always `null` on the wire — frontend computes from user geolocation. */
  distance_km?: number | null;
};

/** Static-resource decorated card. No `ai_reason` — see backend doc. */
export type OpportunityHealthCard = V2OpportunityHealth & {
  /** Count of `classified_interest` overlap with the user. 0..4. */
  match_score?: number;
  /** Always `null` on the wire — frontend computes. */
  distance_km?: number | null;
};

export type FeedSections = {
  today_tomorrow: OpportunityCard[];
  this_week: OpportunityCard[];
  try_new: OpportunityCard[];
};

/** Alias for the spec's name; same shape as FeedSections. */
export type FeedResponse = FeedSections;

/** Filter slug accepted by `GET /feed?filter=…`. */
export type FeedFilter = "health" | "discounts" | "programs";

/**
 * Discriminated union — `source` tells the renderer which card to use.
 * `opportunity_health` rows have no schedule and no RSVP; pick the right
 * card per `source` instead of trying to unify the two shapes.
 */
export type FeedItem =
  | ({ source: "opportunity" } & OpportunityCard)
  | ({ source: "opportunity_health" } & OpportunityHealthCard);

export type FilteredFeedResponse = {
  filter: "health" | "discounts";
  items: FeedItem[];
};

// ---------------------------------------------------------------
// `GET /feed?filter=programs` — государственные программы
// ---------------------------------------------------------------
// See docs/PROGRAMS_FEED_CONTRACT.md for the wire contract. Items
// are pre-filtered server-side by the user's veteran_status; the UI
// groups them by program_category for display and renders the
// always-present hotlines as a footer list.

export type ProgramCategory =
  | "health"
  | "money"
  | "housing"
  | "education_work"
  | "sport_recreation"
  | "support";

export type ProgramFeedItem = {
  source: "opportunity_program";

  id: string;
  created_at: string;
  updated_at: string;

  title: string;
  short_description: string;
  how_to_apply: string | null;
  source_url: string;
  source_label: string | null;

  program_category: ProgramCategory;
  target_veteran_status: VeteranStatus[];

  city: string | null;
  oblast: string | null;
  address: string | null;
  location_lat: number | null;
  location_lng: number | null;
};

export type HotlineItem = {
  id: string;
  label: string;
  phone: string;
  description: string | null;
  display_order: number;
  created_at: string;
};

export type ProgramsFeedResponse = {
  filter: "programs";
  items: ProgramFeedItem[];
  hotlines: HotlineItem[];
};

export type AuthExchangeResponse = {
  /** Bearer token used by every subsequent call. */
  token: string;
  /** ISO timestamp; we refresh before this. */
  expires_at: string;
  user: V2User;
};
