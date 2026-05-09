-- Opportunities: a thing a veteran might attend.
--   start_at is null → opportunity (always-on / drop-in)
--   start_at is set  → event (time-bound)
--
-- Surfaces this table feeds:
--   [MAP]      pins on the city map
--   [PLACE]    the public detail page (by slug)
--   [INTEREST] the matcher that produces user notifications

create extension if not exists pgcrypto;

-- physical / social access flags surfaced on map, place page, and matcher
-- Postgres has no `create type ... if not exists` for enums, so guard manually.
do $$
begin
  if not exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'accessibility_flag' and n.nspname = 'public'
  ) then
    create type public.accessibility_flag as enum (
      'barrier_free',
      'no_stairs',
      'quiet_room',
      'no_alcohol',
      'sign_language',
      'audio_described',
      'sensory_friendly',
      'parking_disabled',
      'service_animal_ok'
    );
  end if;
end $$;

create table public.opportunities (
  id   uuid primary key default gen_random_uuid(),
  slug text unique not null,                                  -- [PLACE] public URL

  -- copy
  title             text not null,                            -- [MAP][PLACE][INTEREST]
  short_description text,                                     -- [MAP][PLACE]
  description       text,                                     -- [PLACE]
  photo_url         text,                                     -- [MAP][PLACE]

  -- where
  city         text not null,                                 -- [MAP][PLACE][INTEREST]
  oblast       text,                                          -- [INTEREST] regional fallback
  address      text,                                          -- [PLACE]
  location_lat numeric(9,6) not null,                         -- [MAP]
  location_lng numeric(9,6) not null,                         -- [MAP]

  -- when (optional → opportunity ; set → event)
  -- start_at + ends_at use `timestamp` (no tz) so the `ends_at` generation
  -- expression qualifies as IMMUTABLE (timestamptz + interval is STABLE).
  -- App layer is responsible for timezone normalization on read/write.
  start_at     timestamp,                                     -- [MAP][PLACE][INTEREST]
  duration_min int,                                           -- [PLACE]
  ends_at      timestamp
    generated always as (
      case
        when start_at is not null and duration_min is not null
        then start_at + make_interval(mins => duration_min)
      end
    ) stored,                                                 -- [MAP][PLACE]

  -- matching axes
  interests           text[] not null default '{}',           -- [INTEREST] && veteran.interests, [MAP] icon, [PLACE] chips
  accessibility_flags public.accessibility_flag[] not null default '{}',
                                                              -- [INTEREST] subset check, [MAP] overlays, [PLACE] list

  -- practical
  price_uah         int,                                      -- [PLACE] null = невідомо, 0 = безкоштовно
  organizer_contact text,                                     -- [PLACE]

  -- system
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- if you give it a duration, you must give it a start
  constraint opportunities_duration_requires_start
    check (duration_min is null or start_at is not null)
);

-- [MAP] viewport — pins for timed events and always-on opportunities
create index opportunities_geo_idx
  on public.opportunities (location_lat, location_lng);

-- [MAP][PLACE] "what's on in <city> next" — only timed events
create index opportunities_city_start_idx
  on public.opportunities (city, start_at)
  where start_at is not null;

-- [MAP][PLACE] always-on list per city
create index opportunities_city_timeless_idx
  on public.opportunities (city)
  where start_at is null;

-- [INTEREST] interest overlap — matcher's hot path
create index opportunities_interests_gin
  on public.opportunities using gin (interests);

-- [INTEREST] accessibility subset check
create index opportunities_accessibility_gin
  on public.opportunities using gin (accessibility_flags);

-- keep updated_at fresh; reuses public.set_updated_at() from 0001b
create trigger opportunities_set_updated_at
  before update on public.opportunities
  for each row execute function public.set_updated_at();

-- RLS — public can browse; writes go through the backend (service role bypasses RLS)
alter table public.opportunities enable row level security;

create policy "opportunities_public_read"
  on public.opportunities for select
  using (true);
