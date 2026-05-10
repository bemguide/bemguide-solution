-- 0011_classified_interest.sql
-- Add a controlled-vocabulary interest taxonomy alongside the existing
-- free-form `interests text[]` columns. The classifier (gemini.service.ts
-- → classifyInterest) populates `classified_interest`; the matcher and
-- notification dispatcher cut over to read this new column in 0012, after
-- the initial backfill completes — that gap is intentional so matching
-- doesn't go dark on empty arrays during the transition.
--
-- `classified_at IS NULL` is the single work signal: backfill, manual
-- re-classify, and the hourly catch-up cron all SELECT on it. Inserts
-- default to `'{}'` and leave classified_at NULL, so the row is functional
-- immediately and the classifier fills both fields asynchronously.

-- 1) Enum --------------------------------------------------------------------
-- Audience labels (ветерани / військові / інвалідність) deliberately
-- omitted; those are targeting fields (target_veteran_status,
-- target_age_range, accessibility_flags), not interests.

create type public.classified_interest as enum (
  -- Physical / movement
  'physical_sport',
  'adaptive_sport',
  'equine_therapy',
  'outdoor_recreation',

  -- Creative / cultural
  'art_therapy',
  'music',
  'creative_workshop',
  'cultural_event',

  -- Health / therapy
  'rehabilitation',
  'recovery',
  'psychological_support',
  'medical_care',

  -- Practical / life
  'legal_aid',
  'education',
  'career_development',
  'employment',
  'financial_aid',
  'discount_promotions',

  -- Social
  'support_group',
  'community_meetup',
  'family_support',
  'women_support'
);

-- 2) Columns + indexes -------------------------------------------------------

alter table public.opportunities
  add column classified_interest   public.classified_interest[] not null default '{}',
  add column classified_at         timestamptz,
  add column classifier_version    text,
  add column classifier_confidence numeric;

create index opportunities_classified_interest_gin
  on public.opportunities using gin (classified_interest);

create index opportunities_classified_at_null_idx
  on public.opportunities (classified_at) where classified_at is null;

alter table public.opportunity_health
  add column classified_interest   public.classified_interest[] not null default '{}',
  add column classified_at         timestamptz,
  add column classifier_version    text,
  add column classifier_confidence numeric;

create index opportunity_health_classified_interest_gin
  on public.opportunity_health using gin (classified_interest);

create index opportunity_health_classified_at_null_idx
  on public.opportunity_health (classified_at) where classified_at is null;

alter table public.users
  add column classified_interest   public.classified_interest[] not null default '{}',
  add column classified_at         timestamptz,
  add column classifier_version    text,
  add column classifier_confidence numeric;

create index users_classified_interest_gin
  on public.users using gin (classified_interest);

create index users_classified_at_null_idx
  on public.users (classified_at) where classified_at is null;

-- 3) Note on compute_match_score ---------------------------------------------
-- This migration intentionally does NOT modify compute_match_score. The
-- function still reads the old `interests text[]` columns until 0012, so
-- existing matches keep working through the backfill window. After
-- backfill completes and rows have classified_interest populated, 0012
-- will CREATE OR REPLACE the function to read the new column.
