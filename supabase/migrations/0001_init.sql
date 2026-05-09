-- 0001_init.sql — Поруч schema (events + RSVPs + moderation + notifications + bot state)
-- Idempotent: drops everything first, then recreates from scratch. Safe to re-run
-- during M2 setup. After we have data (M3+), schema changes go in 0003+ migrations.

create extension if not exists pgcrypto;

-- =========================
-- clean slate (drops in dependency order; cascade clears views/policies)
-- =========================
drop function if exists public.public_rsvp_count(uuid) cascade;
drop function if exists public.tg_set_updated_at() cascade;

drop table if exists bot_sessions cascade;
drop table if exists discovery_sources cascade;
drop table if exists shares cascade;
drop table if exists notifications cascade;
drop table if exists moderation_log cascade;
drop table if exists ratings cascade;
drop table if exists rsvps cascade;
drop table if exists events cascade;
drop table if exists veterans cascade;
drop table if exists organizations cascade;
drop table if exists cities cascade;

drop type if exists rsvp_status cascade;
drop type if exists event_status cascade;
drop type if exists event_source cascade;
drop type if exists rating_score cascade;
drop type if exists discovery_channel cascade;
drop type if exists accessibility_flag cascade;
drop type if exists interest_category cascade;
drop type if exists identity_pref cascade;
drop type if exists notification_type cascade;
drop type if exists notification_status cascade;

-- =========================
-- enums
-- =========================
create type rsvp_status as enum ('going', 'declined', 'deferred', 'attended', 'no_show');
create type event_status as enum ('draft', 'pending', 'approved', 'rejected', 'archived');
create type event_source as enum ('organizer', 'veteran_submission', 'admin_seed');
create type rating_score as enum ('up', 'meh', 'down');
create type discovery_channel as enum (
  'go_partner',
  'peer_share',
  'family_share',
  'flyer_qr',
  'instagram',
  'cold_search',
  'cross_link',
  'unknown'
);
create type accessibility_flag as enum (
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
create type interest_category as enum (
  'movement',
  'learning',
  'community',
  'craft',
  'volunteering',
  'walks',
  'reading',
  'family'
);
create type identity_pref as enum (
  'any',
  'women_only',
  'men_only',
  'mixed_with_women_emphasis',
  'family_friendly'
);
create type notification_type as enum (
  'rsvp_confirm',
  'reminder_24h',
  'reminder_10m',
  'post_event',
  'event_published',
  'moderation_decision',
  'broadcast'
);
create type notification_status as enum ('pending', 'sent', 'failed', 'cancelled');

-- =========================
-- core tables
-- =========================

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  contact_phone text,
  contact_telegram text,
  type text,
  city text not null,
  oblast text,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table veterans (
  id uuid primary key default gen_random_uuid(),
  tg_user_id bigint unique,
  display_name text,
  city text,
  oblast text,
  interests interest_category[] not null default '{}',
  accessibility_flags accessibility_flag[] not null default '{}',
  identity_prefs identity_pref not null default 'any',
  comfort_notes text,
  show_name_publicly boolean not null default false,
  reminders_enabled boolean not null default true,
  language text not null default 'uk',
  onboarded_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now()
);

create index veterans_tg_idx on veterans (tg_user_id);
create index veterans_city_idx on veterans (city);

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,
  title text not null,
  short_description text,
  description text,
  organizer_id uuid references organizations (id),
  city text not null,
  oblast text,
  address text,
  location_lat numeric(9, 6),
  location_lng numeric(9, 6),
  start_at timestamptz not null,
  duration_min integer not null default 60,
  recurrence text,
  categories interest_category[] not null default '{}',
  identity_tag identity_pref not null default 'any',
  accessibility_flags accessibility_flag[] not null default '{}',
  honest_absences text[],
  price_uah integer not null default 0,
  photo_url text,
  organizer_contact text,
  source event_source not null default 'organizer',
  status event_status not null default 'pending',
  ai_screen_score numeric(3, 2),
  ai_screen_notes jsonb,
  moderator_id uuid,
  moderator_notes text,
  published_at timestamptz,
  created_by_veteran_id uuid references veterans (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_city_start_idx on events (city, start_at) where status = 'approved';
create index events_status_idx on events (status);
create index events_slug_idx on events (slug);

create table rsvps (
  id uuid primary key default gen_random_uuid(),
  veteran_id uuid not null references veterans (id) on delete cascade,
  event_id uuid not null references events (id) on delete cascade,
  status rsvp_status not null default 'going',
  qr_token text unique,
  show_name_publicly boolean not null default false,
  reminders_enabled boolean not null default true,
  defer_until timestamptz,
  is_ghost boolean not null default false,
  created_at timestamptz not null default now(),
  unique (veteran_id, event_id)
);

create index rsvps_event_idx on rsvps (event_id) where status = 'going';
create index rsvps_veteran_idx on rsvps (veteran_id);

create table ratings (
  id uuid primary key default gen_random_uuid(),
  rsvp_id uuid not null unique references rsvps (id) on delete cascade,
  score rating_score not null,
  peer_quote text,
  peer_quote_approved boolean not null default false,
  peer_quote_attribution text,
  created_at timestamptz not null default now()
);

create table moderation_log (
  id bigserial primary key,
  event_id uuid not null references events (id) on delete cascade,
  moderator_id uuid,
  action text not null,
  notes text,
  diff jsonb,
  created_at timestamptz not null default now()
);

create index moderation_log_event_idx on moderation_log (event_id);

create table notifications (
  id bigserial primary key,
  veteran_id uuid not null references veterans (id) on delete cascade,
  event_id uuid references events (id) on delete cascade,
  rsvp_id uuid references rsvps (id) on delete cascade,
  type notification_type not null,
  payload jsonb not null,
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status notification_status not null default 'pending',
  failure_reason text,
  retry_count integer not null default 0,
  created_at timestamptz not null default now()
);

create index notifications_due_idx on notifications (scheduled_for) where status = 'pending';
create index notifications_veteran_idx on notifications (veteran_id);

create table shares (
  id bigserial primary key,
  veteran_id uuid references veterans (id),
  event_id uuid not null references events (id) on delete cascade,
  channel text not null,
  created_at timestamptz not null default now()
);

create table discovery_sources (
  id bigserial primary key,
  veteran_id uuid not null references veterans (id) on delete cascade,
  channel discovery_channel not null,
  details jsonb,
  created_at timestamptz not null default now()
);

create table cities (
  slug text primary key,
  name_uk text not null,
  oblast text not null,
  population integer,
  is_demo_city boolean not null default false
);

-- bot conversation state (folded in here per tech-lead decision; spec'd in 04_TG_BOT.md)
create table bot_sessions (
  user_id bigint primary key,
  flow text not null,
  step integer not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================
-- triggers
-- =========================

create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger events_updated_at
  before update on events
  for each row
  execute function public.tg_set_updated_at();

create trigger bot_sessions_updated_at
  before update on bot_sessions
  for each row
  execute function public.tg_set_updated_at();
