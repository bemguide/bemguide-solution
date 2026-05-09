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
  // 10 statuses from Ukrainian veteran law (uvbd-1 through uvbd-10) plus 2 extras.
  | "uvbd_1"
  | "uvbd_2"
  | "uvbd_3"
  | "uvbd_4"
  | "uvbd_5"
  | "uvbd_6"
  | "uvbd_7"
  | "uvbd_8"
  | "uvbd_9"
  | "uvbd_10"
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
  /** Free-form interest tags — backend stores `text[]`, no enum gate. */
  interests: string[];
  accessibility_flags: AccessibilityFlag[];
  price_uah: number | null;
  organizer_contact: string | null;
  /** [] = no preference. Multi-select. */
  target_age_range: AgeRange[];
  target_identity_pref: IdentityPref;
  /** [] = no preference. Multi-select. */
  target_veteran_status: VeteranStatus[];
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

export type FeedSections = {
  today_tomorrow: OpportunityCard[];
  this_week: OpportunityCard[];
  try_new: OpportunityCard[];
};

export type AuthExchangeResponse = {
  /** Bearer token used by every subsequent call. */
  token: string;
  /** ISO timestamp; we refresh before this. */
  expires_at: string;
  user: V2User;
};
