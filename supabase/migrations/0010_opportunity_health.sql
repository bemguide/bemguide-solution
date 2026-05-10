-- 0010_opportunity_health.sql
-- Static (always-on) health resources: rehab centers, recovery groups, healing
-- spaces. Mirrors `opportunities` for location/targeting/accessibility, but
-- has no schedule (no start_at/ends_at/duration_min), a constrained interest
-- enum, and an aggregate visit_count instead of per-user attendees.

-- 1) Enums -------------------------------------------------------------------

create type public.health_type as enum ('static');

create type public.health_interest as enum (
  'rehabilitation',
  'recovery',
  'healing'
);

-- 2) Table -------------------------------------------------------------------

create table public.opportunity_health (
  id                    uuid primary key default gen_random_uuid(),

  -- Discriminator. Single value today; extensible without table migration.
  type                  public.health_type not null default 'static',

  -- Identity / copy
  title                 text not null,
  short_description     text,
  description           text,
  photo_url             text,

  -- Location (mirrors opportunities; lat/lng required for distance math)
  city                  text not null,
  oblast                text,
  address               text,
  location_lat          numeric not null,
  location_lng          numeric not null,

  -- Constrained interests. At least one tag is required so the entry is
  -- discoverable; empty arrays would never surface.
  interests             public.health_interest[]
    not null default '{}'
    check (array_length(interests, 1) >= 1),

  -- Targeting / accessibility (mirrors opportunities)
  accessibility_flags   public.accessibility_flag[] not null default '{}',
  target_age_range      public.age_range[] not null default '{}',
  target_identity_pref  public.identity_pref not null default 'any',
  target_veteran_status public.veteran_status[] not null default '{}',

  -- Practical
  price_uah             integer,
  organizer_contact     text,

  -- Aggregate attendance: a counter, not a roster.
  visit_count           integer not null default 0
                        check (visit_count >= 0),

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 3) Indexes -----------------------------------------------------------------

create index opportunity_health_city_idx
  on public.opportunity_health (city);

create index opportunity_health_interests_gin
  on public.opportunity_health using gin (interests);

create index opportunity_health_accessibility_gin
  on public.opportunity_health using gin (accessibility_flags);

-- 4) updated_at trigger ------------------------------------------------------
-- set_updated_at() already exists from 0001b_harden_set_updated_at.

create trigger opportunity_health_set_updated_at
before update on public.opportunity_health
for each row
execute function public.set_updated_at();

-- 5) RLS ---------------------------------------------------------------------
-- Mirror `opportunities`: public read, writes restricted to service role
-- (service role bypasses RLS, so we just need a permissive read policy).

alter table public.opportunity_health enable row level security;

create policy opportunity_health_public_read
on public.opportunity_health
for select
to anon, authenticated
using (true);
