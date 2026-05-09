// v2 API types. Mirrors `docs/SCHEMA.md` so the wire shapes match the v2
// Postgres tables one-for-one. Update both files together when the schema
// shifts.

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
  /** Naive timestamp string (no tz) — caller normalises to Europe/Kyiv. */
  start_at: string | null;
  duration_min: number | null;
  /** Generated column = start_at + duration_min. Read-only. */
  ends_at: string | null;
  interests: string[];
  accessibility_flags: AccessibilityFlag[];
  price_uah: number | null;
  organizer_contact: string | null;
  target_age_range: AgeRange[];
  target_identity_pref: IdentityPref;
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
  /** Personalisation: included when the request was authed. */
  match_score?: number;
  ai_reason?: string;
  /** count of accepted attendees (includes ghost rows from seed). */
  attendee_count?: number;
  /** opt-in display_names from accepted attendees (subset only). */
  names_visible?: string[];
  /** km from the requesting user's city centroid. */
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
