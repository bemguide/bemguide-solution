-- 0014_opportunity_program.sql
-- State (government) programs for veterans. Static, link-driven cards
-- gated by veteran_status and grouped by program_category. Mirrors the
-- opportunity_health pattern (no schedule, public read, RLS on) but stays
-- a separate table because:
--   • program_category is a closed taxonomy (≠ free-form interests)
--   • source_url is required (every program points to an official source)
--   • most programs are oblast/state-wide, so lat/lng are nullable
--
-- Surface this table feeds:
--   GET /feed?filter=programs  → flat list, scoped by user.veteran_status,
--                                 ordered by program_category then title.

-- 1) Enums -------------------------------------------------------------------

create type public.program_category as enum (
  'health',           -- 🩺 Здоров'я
  'money',            -- 💰 Гроші
  'housing',          -- 🏠 Житло
  'education_work',   -- 🎓 Освіта і робота
  'sport_recreation', -- 🏋️ Спорт і відпочинок
  'support'           -- 🤝 Підтримка
);

-- 2) Table -------------------------------------------------------------------

create table public.opportunity_program (
  id                    uuid primary key default gen_random_uuid(),

  -- Copy
  title                 text not null,
  short_description     text not null,           -- the one-line benefit hook
  how_to_apply          text,                    -- multi-line "Як:" body
  source_url            text not null,           -- official source link
  source_label          text,                    -- optional UI label for link

  -- Categorization
  program_category      public.program_category not null,

  -- Eligibility: which veteran_status values the program is open to.
  -- Mirrors the doc's 3-status filter (УБД / В процесі / Демобілізований без
  -- статусу) but stored as the full veteran_status[] for forward compat.
  -- Required to be non-empty so a program is always discoverable by SOME
  -- audience — empty arrays would be invisible to every user.
  target_veteran_status public.veteran_status[] not null default '{}'
    check (array_length(target_veteran_status, 1) >= 1),

  -- Location: nullable because most programs are state-wide. A handful
  -- (Госпіталь ветеранів, Ветеранський простір, ЦПЗ, БПД) reference a
  -- physical address — those rows fill in city/address/lat/lng.
  city                  text,
  oblast                text,
  address               text,
  location_lat          numeric(9,6),
  location_lng          numeric(9,6),

  -- System
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- 3) Indexes -----------------------------------------------------------------

create index opportunity_program_category_idx
  on public.opportunity_program (program_category);

-- GIN over target_veteran_status for the matcher's `&&` overlap query
create index opportunity_program_status_gin
  on public.opportunity_program using gin (target_veteran_status);

-- City filter is an optional scope on the feed; partial index keeps it lean
create index opportunity_program_city_idx
  on public.opportunity_program (city)
  where city is not null;

-- 4) updated_at trigger ------------------------------------------------------
-- set_updated_at() already exists from 0001b_harden_set_updated_at.

create trigger opportunity_program_set_updated_at
before update on public.opportunity_program
for each row
execute function public.set_updated_at();

-- 5) Hotlines ----------------------------------------------------------------
-- The "📞 Гарячі лінії" footer in the doc — short, ordered list of phone
-- numbers. Lives in its own tiny table so the UI can render it as a static
-- block independent of the program cards.

create table public.program_hotline (
  id            uuid primary key default gen_random_uuid(),
  label         text not null,                   -- e.g. "Єдина ветеранська лінія"
  phone         text not null,                   -- e.g. "1528"
  description   text,                            -- e.g. "психологічна підтримка"
  display_order int  not null default 0,
  created_at    timestamptz not null default now()
);

create index program_hotline_order_idx
  on public.program_hotline (display_order);

-- 6) RLS ---------------------------------------------------------------------
-- Mirror opportunity_health: public read, writes restricted to service role
-- (which bypasses RLS).

alter table public.opportunity_program enable row level security;
alter table public.program_hotline     enable row level security;

create policy opportunity_program_public_read
on public.opportunity_program
for select
to anon, authenticated
using (true);

create policy program_hotline_public_read
on public.program_hotline
for select
to anon, authenticated
using (true);
