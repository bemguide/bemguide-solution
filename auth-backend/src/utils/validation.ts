import { z } from 'zod';
import { Constants } from '../types/supabase.generated.js';
import { AppError } from './errors.js';

// Centralised zod helpers + concrete schemas. Routes call parse() and let any
// ZodError get translated to a 400 by parseOrThrow below.

export function parseOrThrow<T>(schema: z.ZodType<T>, value: unknown, label = 'request body'): T {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw AppError.validation(`Invalid ${label}`, result.error.flatten());
  }
  return result.data;
}

// Reuse the runtime enum constants from generated types so adding a value to
// Postgres + regenerating types automatically propagates here.
const ageRangeEnum = z.enum(Constants.public.Enums.age_range);
const accessibilityFlagEnum = z.enum(Constants.public.Enums.accessibility_flag);
const companyPreferenceEnum = z.enum(Constants.public.Enums.company_preference);
const veteranStatusEnum = z.enum(Constants.public.Enums.veteran_status);
const identityPrefEnum = z.enum(Constants.public.Enums.identity_pref);
const invitationResponseEnum = z.enum(['accepted', 'declined'] as const); // 'ignored' is worker-set
const attendeeStatusEnum = z.enum(Constants.public.Enums.attendee_status);

// ──────────────────────────────────────────────────────────────────────────
// Onboarding (Q1–Q12)
// ──────────────────────────────────────────────────────────────────────────

// PATCH semantics: every field optional; only provided fields update. Empty
// arrays/strings explicitly set the column to empty/null.
// Limits per the v2 frontend contract:
//   interests: max 32 items, each ≤80 chars
//   bio: ≤500 chars
// Other limits stay generous — they are belt-and-suspenders only.
export const onboardingPatchSchema = z
  .object({
    city: z.string().min(1).max(120).nullable(),
    display_name: z.string().min(1).max(120).nullable(),
    show_name_publicly: z.boolean(),
    interests: z.array(z.string().min(1).max(80)).max(32),
    availability: z.array(z.string().min(1).max(80)).max(32),
    schedule_constraints: z.string().max(2000).nullable(),
    company_preference: companyPreferenceEnum,
    accessibility_flags: z.array(accessibilityFlagEnum).max(20),
    triggers_to_avoid: z.array(z.string().min(1).max(80)).max(32),
    veteran_status: veteranStatusEnum.nullable(),
    role_in_group: z.string().max(200).nullable(),
    age_range: ageRangeEnum.nullable(),
    bio: z.string().max(500).nullable(),
  })
  .partial()
  .strict();
export type OnboardingPatchInput = z.infer<typeof onboardingPatchSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Telegram link
// ──────────────────────────────────────────────────────────────────────────

export const telegramLinkSchema = z.object({
  token: z.string().min(10).max(2048),
});

// ──────────────────────────────────────────────────────────────────────────
// Opportunities (events)
// ──────────────────────────────────────────────────────────────────────────

// timestamp (no tz) + duration → ends_at is generated. App layer feeds the DB
// a wall-clock-UTC ISO string with no offset, so accept ISO datetime then strip
// 'Z'/offset before insert.
const wallClockTimestamp = z
  .string()
  .datetime({ offset: true })
  .transform((s) => s.replace(/Z$|[+-]\d{2}:?\d{2}$/, ''));

export const createOpportunitySchema = z.object({
  title: z.string().min(1).max(200),
  short_description: z.string().max(500).nullish(),
  description: z.string().max(10000).nullish(),
  photo_url: z.string().url().max(2048).nullish(),
  city: z.string().min(1).max(120),
  oblast: z.string().max(120).nullish(),
  address: z.string().max(500).nullish(),
  location_lat: z.number().min(-90).max(90),
  location_lng: z.number().min(-180).max(180),
  start_at: wallClockTimestamp.nullish(),
  duration_min: z
    .number()
    .int()
    .positive()
    .max(60 * 24 * 14)
    .nullish(),
  interests: z.array(z.string().min(1).max(80)).max(64).optional(),
  accessibility_flags: z.array(accessibilityFlagEnum).max(20).optional(),
  price_uah: z.number().int().nonnegative().nullish(),
  organizer_contact: z.string().max(500).nullish(),
  target_age_range: z.array(ageRangeEnum).max(6).optional(),
  target_identity_pref: identityPrefEnum.optional(),
  target_veteran_status: z.array(veteranStatusEnum).max(12).optional(),
  // Public route always overwrites with req.user.id; admin alias honours this
  // override so admins can create events on behalf of veterans.
  created_by: z.string().uuid().optional(),
});
export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;

export const updateOpportunitySchema = createOpportunitySchema.partial();
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;

export const listOpportunitiesQuerySchema = z.object({
  city: z.string().min(1).max(120).optional(),
  from: z.string().datetime({ offset: true }).optional(),
  to: z.string().datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(2048).optional(),
});

// ──────────────────────────────────────────────────────────────────────────
// Invitations
// ──────────────────────────────────────────────────────────────────────────

export const respondInvitationSchema = z.object({
  response: invitationResponseEnum,
});

// ──────────────────────────────────────────────────────────────────────────
// Attendance
// ──────────────────────────────────────────────────────────────────────────

export const updateAttendanceSchema = z.object({
  status: attendeeStatusEnum,
});

// ──────────────────────────────────────────────────────────────────────────
// Generic list query
// ──────────────────────────────────────────────────────────────────────────

export const listQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(100).optional(),
  cursor: z.string().min(1).max(2048).optional(),
});
