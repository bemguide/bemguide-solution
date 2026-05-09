-- public.users — new user table that lives ALONGSIDE public.profiles.
--
-- Holds the 12 onboarding answers plus the link to auth.users(id).
-- profiles is left untouched so anything still pointing at it keeps
-- working; new code targets public.users.

-- 1) veteran_status enum.
--    Combines the 10 Ukrainian-law veteran categories (originally drafted in
--    0005_profiles_veteran_status) with the 2 practical questionnaire states
--    this migration introduces (`in_process`, `no_docs`). Self-contained:
--    creates the enum if missing so 0007 can apply without depending on 0005.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'veteran_status' and n.nspname = 'public'
  ) then
    create type public.veteran_status as enum (
      'ubd',                    -- учасник бойових дій
      'volunteer',              -- доброволець (добровольчих формувань)
      'active_duty',            -- військовослужбовець (на службі)
      'veteran',                -- ветеран війни / демобілізований
      'war_disabled',           -- особа з інвалідністю внаслідок війни
      'former_pow',             -- колишній полонений
      'family_of_fallen',       -- член сім'ї загиблого / померлого
      'family_of_missing',      -- член сім'ї зниклого безвісти / полоненого
      'family_of_veteran',      -- член сім'ї ветерана
      'civilian_affected',      -- цивільний, постраждалий від війни
      'in_process',             -- в процесі оформлення
      'no_docs'                 -- без документів
    );
  end if;
end $$;
-- Belt-and-suspenders: if the enum was created elsewhere with only the 10
-- core values, top it up. No-op when all 12 values already exist.
alter type public.veteran_status add value if not exists 'in_process';   -- в процесі оформлення
alter type public.veteran_status add value if not exists 'no_docs';      -- без документів

-- 2) supporting enums for the questionnaire
create type public.company_preference as enum (
  'with_partner',           -- з партнером
  'women_only',             -- з жінками
  'mixed',                  -- змішано
  'close_ones',             -- з близькими
  'any'                     -- будь-як
);

create type public.age_range as enum (
  '18_24', '25_34', '35_44', '45_54', '55_64', '65_plus'
);

-- 3) the table
create table public.users (
  id    uuid primary key references auth.users(id) on delete cascade,
  email text not null unique,

  -- Q1  Місто
  city text,

  -- Q2  Ім'я або анонімно
  display_name        text,                                   -- "Дмитро" or null
  show_name_publicly  boolean not null default false,         -- false = "Анонімно" on cards

  -- Q3  Що цікаво (multi-select, free-form for MVP)
  interests text[] not null default '{}',

  -- Q4  Який ритм / коли вільний
  availability text[] not null default '{}',                  -- e.g. {'weekday_evening','weekend_morning'}

  -- Q5  Що з графіку важливо врахувати (free text)
  schedule_constraints text,                                  -- "діти, догляд за мамою"

  -- Q6  В якій компанії бути
  company_preference public.company_preference not null default 'any',

  -- Q7  Що важливо для комфорту (accessibility — same enum opportunities use)
  accessibility_flags public.accessibility_flag[] not null default '{}',

  -- Q8  Тригери, яких уникати
  triggers_to_avoid text[] not null default '{}',             -- e.g. {'loud','crowds','military','alcohol','surprises'}

  -- Q9  Статус
  veteran_status public.veteran_status,                       -- nullable: "не вказано"

  -- Q10 Що приносиш у збір (роль)
  role_in_group text,                                         -- "слухаю", "переклад", "просто бути"

  -- Q11 Орієнтовний вік
  age_range public.age_range,

  -- Q12 Free text про себе
  bio text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 4) indexes for the matcher and common filters
create index users_city_idx               on public.users (city);
create index users_interests_gin          on public.users using gin (interests);
create index users_accessibility_gin      on public.users using gin (accessibility_flags);
create index users_triggers_gin           on public.users using gin (triggers_to_avoid);
create index users_veteran_status_idx     on public.users (veteran_status);
create index users_company_preference_idx on public.users (company_preference);

-- 5) updated_at trigger (reuses public.set_updated_at from 0001b)
create trigger users_set_updated_at
  before update on public.users
  for each row execute function public.set_updated_at();

-- 6) RLS — owner-only access; backend writes via service role
alter table public.users enable row level security;

create policy "users_self_read"
  on public.users for select
  using (auth.uid() = id);

create policy "users_self_insert"
  on public.users for insert
  with check (auth.uid() = id);

create policy "users_self_update"
  on public.users for update
  using (auth.uid() = id)
  with check (auth.uid() = id);
