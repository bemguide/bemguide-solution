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
import type {
  ColorblindPalette,
  FontSize,
  HealthCategory,
} from "@/lib/app-prefs";

export type Option<T extends string> = { value: T; label: string };

/** Variant of `Option` that supports a "soon" flag for in-progress
 *  features rendered disabled with a "Скоро" badge. */
export type RoadmapOption<T extends string> = Option<T> & { soon?: boolean };

// ---------------------------------------------------------------
// New steps: Адаптація застосунку (accessibility prefs)
// ---------------------------------------------------------------

export const FONT_SIZE_OPTIONS: Option<FontSize>[] = [
  { value: "s", label: "Менший" },
  { value: "m", label: "Звичайний" },
  { value: "l", label: "Більший" },
];

export const PALETTE_OPTIONS: Option<ColorblindPalette>[] = [
  { value: "standard", label: "Стандарт" },
  { value: "protanopia", label: "Протанопія" },
  { value: "deuteranopia", label: "Дейтеранопія" },
  { value: "tritanopia", label: "Тританопія" },
];

// ---------------------------------------------------------------
// New steps: блок «Здоров'я»
// ---------------------------------------------------------------

export const HEALTH_CATEGORY_OPTIONS: RoadmapOption<HealthCategory>[] = [
  { value: "treatment", label: "Лікування" },
  { value: "rehabilitation", label: "Реабілітація" },
  { value: "mental_health", label: "Ментальне здоров'я" },
  { value: "prosthetics", label: "Протезування", soon: true },
  { value: "dentistry", label: "Стоматологія", soon: true },
];

/** Per-category direction lists. Empty array means "no directions
 *  configured yet" (e.g. `prosthetics`/`dentistry` are gated behind
 *  the «Скоро» state and never show this step). */
export const HEALTH_DIRECTIONS: Record<HealthCategory, Option<string>[]> = {
  treatment: [
    { value: "oncology", label: "Лікування онкологічних захворювань" },
    { value: "primary", label: "Первинна медична допомога" },
    { value: "palliative", label: "Паліативна медична допомога" },
    { value: "ophthalmology", label: "Офтальмологічна допомога" },
    { value: "transplantation", label: "Трансплантація" },
    { value: "gynecology_urology", label: "Гінекологія і урологія" },
    { value: "available_drugs", label: "Доступні ліки" },
    { value: "aesthetic", label: "Естетична медицина (рубці, шрами)" },
  ],
  rehabilitation: [
    { value: "outpatient", label: "Амбулаторна реабілітація" },
    { value: "centers_map", label: "Мапа з реабілітаційними центрами" },
    { value: "inpatient", label: "Стаціонарна реабілітація" },
    { value: "aids", label: "Допоміжні засоби реабілітації" },
    { value: "after_captivity", label: "Реабілітація після полону" },
    { value: "vision_loss_adapt", label: "Адаптація для тих, хто втратив зір" },
    { value: "abroad", label: "Реабілітація за кордоном" },
  ],
  mental_health: [
    { value: "psychology", label: "Психологічні послуги" },
    { value: "support_groups", label: "Групи підтримки" },
    { value: "psychiatry", label: "Психіатрична допомога" },
    { value: "addictions", label: "Лікування залежностей" },
  ],
  prosthetics: [],
  dentistry: [],
};

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

// Q11 — age range (single). Backend enum.
export const AGE_RANGE_OPTIONS: Option<AgeRange>[] = [
  { value: "18_24", label: "18–24" },
  { value: "25_34", label: "25–34" },
  { value: "35_44", label: "35–44" },
  { value: "45_54", label: "45–54" },
  { value: "55_64", label: "55–64" },
  { value: "65_plus", label: "65+" },
];
