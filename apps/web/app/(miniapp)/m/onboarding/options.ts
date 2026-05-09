// Option lists + UA labels for the 12-parameter onboarding flow. Kept
// adjacent to the page so changes here don't ripple across the rest of
// the app — none of the options below are referenced by anything else
// today.
//
// The free-form `string[]` fields (interests, availability,
// triggers_to_avoid, role_in_group) use slug values rather than the UA
// label so feed-time matching against `opportunities.interests` /
// `opportunities.target_*` arrays stays predictable.

import type {
  AccessibilityFlag,
  AgeRange,
  CompanyPreference,
  VeteranStatus,
} from "@/lib/api";

export type Option<T extends string> = { value: T; label: string };

// Q3 — interests (multi). Subset of @poruch/shared's INTEREST_CATEGORIES
// curated for onboarding ergonomics. Backend stores as text[]; matches
// against `opportunities.interests` via the trigger-driven score
// recompute.
export const INTEREST_OPTIONS: Option<string>[] = [
  { value: "walks", label: "Прогулянки" },
  { value: "coffee", label: "Кава, розмови" },
  { value: "sport", label: "Спорт, рух" },
  { value: "craft", label: "Майстерня, ремесло" },
  { value: "learning", label: "Навчання" },
  { value: "quiet", label: "Тиха компанія" },
  { value: "volunteering", label: "Волонтерити" },
  { value: "family", label: "З родиною" },
];

// Q4 — availability (multi). User picks the rhythm; we don't match on
// this today, but we feed it to Gemini for ai_reason and store for
// future filtering.
export const AVAILABILITY_OPTIONS: Option<string>[] = [
  { value: "today_tomorrow", label: "Сьогодні / завтра" },
  { value: "weekday_evenings", label: "Будні ввечері" },
  { value: "weekends", label: "Вихідні" },
  { value: "this_month_flexible", label: "Цього місяця, не поспішаю" },
];

// Q6 — company preference (single). Backend enum.
export const COMPANY_PREFERENCE_OPTIONS: Option<CompanyPreference>[] = [
  { value: "with_partner", label: "З партнером" },
  { value: "women_only", label: "Жіноча компанія" },
  { value: "mixed", label: "Змішана компанія" },
  { value: "close_ones", label: "З близькими" },
  { value: "any", label: "Будь-як" },
];

// Q7 — accessibility flags (multi). Backend enum. Order chosen to put
// the most-asked first so people skim past the rest if they don't apply.
export const ACCESSIBILITY_OPTIONS: Option<AccessibilityFlag>[] = [
  { value: "barrier_free", label: "Безбар'єрний доступ" },
  { value: "no_stairs", label: "Без сходів" },
  { value: "quiet_room", label: "Тиха кімната" },
  { value: "no_alcohol", label: "Без алкоголю" },
  { value: "sensory_friendly", label: "Сенсорно дружнє" },
  { value: "service_animal_ok", label: "Із твариною супроводу" },
  { value: "sign_language", label: "Із сурдоперекладом" },
  { value: "audio_described", label: "З аудіоописом" },
  { value: "parking_disabled", label: "Паркінг для авто з посвідченням" },
];

// Q8 — triggers to avoid (multi). Free-form list, slug values.
export const TRIGGER_OPTIONS: Option<string>[] = [
  { value: "loud", label: "Гучне" },
  { value: "crowd", label: "Юрба" },
  { value: "military", label: "Мілітарне" },
  { value: "alcohol", label: "Алкоголь поряд" },
  { value: "surprises", label: "Сюрпризи" },
  { value: "fireworks", label: "Феєрверки / різкі звуки" },
];

// Q9 — veteran status (single). Backend enum. Most-likely first so
// people don't have to scroll through 12 radios to find theirs.
export const VETERAN_STATUS_OPTIONS: Option<VeteranStatus>[] = [
  { value: "ubd", label: "Маю посвідчення УБД" },
  { value: "in_process", label: "У процесі оформлення" },
  { value: "veteran", label: "Ветеран" },
  { value: "active_duty", label: "На службі" },
  { value: "war_disabled", label: "Військова інвалідність" },
  { value: "former_pow", label: "Колишній полонений" },
  { value: "family_of_fallen", label: "Близький загиблого" },
  { value: "family_of_missing", label: "Близький зниклого безвісти" },
  { value: "family_of_veteran", label: "Член родини ветерана" },
  { value: "civilian_affected", label: "Постраждалий цивільний" },
  { value: "volunteer", label: "Волонтер" },
  { value: "no_docs", label: "Без документів" },
];

// Q10 — role in group (single). Backend stores as plain text.
export const ROLE_IN_GROUP_OPTIONS: Option<string>[] = [
  { value: "calm_presence", label: "Спокійна присутність — просто буду" },
  { value: "listener", label: "Слухаю — мене легко розговорити" },
  { value: "driver", label: "Маю авто — можу підвезти" },
  { value: "host", label: "Знаю місце — обіцяю мати ідею, де" },
  { value: "initiative", label: "Можу запропонувати — не боюся ініціативи" },
  { value: "messenger", label: "Перші повідомлення — напишу першим" },
];

// Q11 — age range (single). Backend enum.
export const AGE_RANGE_OPTIONS: Option<AgeRange>[] = [
  { value: "18_24", label: "18–24" },
  { value: "25_34", label: "25–34" },
  { value: "35_44", label: "35–44" },
  { value: "45_54", label: "45–54" },
  { value: "55_64", label: "55–64" },
  { value: "65_plus", label: "65+" },
];
