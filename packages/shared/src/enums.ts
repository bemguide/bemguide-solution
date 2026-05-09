// Mirror of Postgres enums (see supabase/migrations/0001_init.sql).
// Update both files together when adding enum values.

export const RSVP_STATUSES = ["going", "declined", "deferred", "attended", "no_show"] as const;
export type RsvpStatus = (typeof RSVP_STATUSES)[number];

export const EVENT_STATUSES = ["draft", "pending", "approved", "rejected", "archived"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const EVENT_SOURCES = ["organizer", "veteran_submission", "admin_seed"] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

export const RATING_SCORES = ["up", "meh", "down"] as const;
export type RatingScore = (typeof RATING_SCORES)[number];

export const DISCOVERY_CHANNELS = [
  "go_partner",
  "peer_share",
  "family_share",
  "flyer_qr",
  "instagram",
  "cold_search",
  "cross_link",
  "unknown",
] as const;
export type DiscoveryChannel = (typeof DISCOVERY_CHANNELS)[number];

export const ACCESSIBILITY_FLAGS = [
  "barrier_free",
  "no_stairs",
  "quiet_room",
  "no_alcohol",
  "sign_language",
  "audio_described",
  "sensory_friendly",
  "parking_disabled",
  "service_animal_ok",
] as const;
export type AccessibilityFlag = (typeof ACCESSIBILITY_FLAGS)[number];

export const ACCESSIBILITY_LABELS_UK: Record<AccessibilityFlag, string> = {
  barrier_free: "безбар'єрно",
  no_stairs: "без сходів",
  quiet_room: "тиха кімната",
  no_alcohol: "без алкоголю",
  sign_language: "із сурдоперекладом",
  audio_described: "з аудіоописом",
  sensory_friendly: "сенсорно дружнє",
  parking_disabled: "паркінг для авто з посвідченням",
  service_animal_ok: "з твариною супроводу",
};

export const INTEREST_CATEGORIES = [
  "movement",
  "learning",
  "community",
  "craft",
  "volunteering",
  "walks",
  "reading",
  "family",
] as const;
export type InterestCategory = (typeof INTEREST_CATEGORIES)[number];

export const INTEREST_LABELS_UK: Record<InterestCategory, string> = {
  movement: "рух",
  learning: "навчитися чомусь",
  community: "спільнота",
  craft: "творчість",
  volunteering: "волонтерити",
  walks: "просто пройтися",
  reading: "читання",
  family: "з родиною",
};

export const IDENTITY_PREFS = [
  "any",
  "women_only",
  "men_only",
  "mixed_with_women_emphasis",
  "family_friendly",
] as const;
export type IdentityPref = (typeof IDENTITY_PREFS)[number];

export const IDENTITY_LABELS_UK: Record<IdentityPref, string> = {
  any: "будь-хто",
  women_only: "жіночі групи",
  men_only: "чоловічі групи",
  mixed_with_women_emphasis: "змішано, з акцентом на жінок",
  family_friendly: "з родиною",
};

export const NOTIFICATION_TYPES = [
  "rsvp_confirm",
  "reminder_24h",
  "reminder_10m",
  "post_event",
  "event_published",
  "moderation_decision",
  "broadcast",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const NOTIFICATION_STATUSES = ["pending", "sent", "failed", "cancelled"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

// Demo cities highlighted in onboarding dropdown.
export const DEMO_CITIES = ["Київ", "Львів", "Дніпро"] as const;
