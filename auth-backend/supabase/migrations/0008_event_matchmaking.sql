-- Event matchmaking — v2 lane on top of public.users + public.opportunities.
--
-- Adds:
--   * 1 column on public.users           (telegram_user_id)
--   * 3 columns on public.opportunities  (target_age_range, target_identity_pref, target_veteran_status)
--   * 3 enums                            (invitation_delivery_status, invitation_response, attendee_status)
--   * 4 tables                           (event_matches, event_invitations, event_attendees, event_rooms)
--   * 1 SQL function                     (public.compute_match_score)
--   * 3 trigger functions + their triggers
--   * RLS policies on the 4 new tables
--
-- Touches v1 (veterans/events/rsvps/notifications): NONE. Bridging v1↔v2 is
-- intended to live at the app layer ("change on the go"), not in this schema.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1) extend public.users with the telegram identity column
-- ─────────────────────────────────────────────────────────────────────────────

-- nullable: a user may exist without a Telegram account.
-- unique: one Telegram identity maps to at most one app user.
alter table public.users
  add column if not exists telegram_user_id bigint unique;


-- ─────────────────────────────────────────────────────────────────────────────
-- 2) extend public.opportunities with audience-target columns
-- ─────────────────────────────────────────────────────────────────────────────

-- empty array / 'any' = "no audience preference, matches everyone".
-- target_identity_pref reuses the legacy public.identity_pref enum on purpose
-- (clean concept; duplicating it under a new name in v2 would cause future merge pain).
alter table public.opportunities
  add column if not exists target_age_range       public.age_range[]      not null default '{}',
  add column if not exists target_identity_pref   public.identity_pref    not null default 'any',
  add column if not exists target_veteran_status  public.veteran_status[] not null default '{}';


-- ─────────────────────────────────────────────────────────────────────────────
-- 3) new enums
-- ─────────────────────────────────────────────────────────────────────────────

create type public.invitation_delivery_status as enum (
  'pending',     -- queued, not yet sent
  'sent',        -- delivered to the channel (e.g. Telegram message_id known)
  'failed',      -- channel rejected; check failure_reason
  'cancelled'    -- explicitly cancelled before send (e.g. event archived)
);

create type public.invitation_response as enum (
  'accepted',    -- user said yes → joins event_attendees
  'declined',    -- user said no  → sticky, no re-invite
  'ignored'      -- expired without response
);

create type public.attendee_status as enum (
  'joining',     -- accepted, event hasn't happened yet (default)
  'attended',    -- confirmed at the event
  'no_show',     -- accepted but didn't show
  'left'         -- pulled out / left the room before the event
);


-- ─────────────────────────────────────────────────────────────────────────────
-- 4) tables
-- ─────────────────────────────────────────────────────────────────────────────

-- event_matches: precomputed candidate set.
-- Only rows with score > 0 are stored (zero-score = excluded by hard filters).
create table public.event_matches (
  event_id    uuid not null references public.opportunities(id) on delete cascade,
  user_id     uuid not null references public.users(id)         on delete cascade,
  score       numeric not null check (score > 0),
  computed_at timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_matches_user_score_idx  on public.event_matches (user_id,  score desc);
create index event_matches_event_score_idx on public.event_matches (event_id, score desc);


-- event_invitations: invite + delivery + response, all in one row.
-- Sticky declines via unique (event_id, user_id) — one invite per user per event, ever.
create table public.event_invitations (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.opportunities(id) on delete cascade,
  user_id         uuid not null references public.users(id)         on delete cascade,
  score_at_invite numeric not null,

  -- delivery
  channel             text not null check (channel in ('telegram', 'email', 'inapp')),
  channel_external_id text,                                                    -- e.g. telegram message_id
  scheduled_for       timestamptz not null default now(),
  sent_at             timestamptz,
  delivery_status     public.invitation_delivery_status not null default 'pending',
  failure_reason      text,
  retry_count         int  not null default 0,

  -- response
  responded_at timestamptz,
  response     public.invitation_response,

  created_at timestamptz not null default now(),

  unique (event_id, user_id)
);
create index event_invitations_user_response_idx
  on public.event_invitations (user_id, response, sent_at);
create index event_invitations_pending_dispatch_idx
  on public.event_invitations (scheduled_for)
  where delivery_status = 'pending';


-- event_attendees: the "list" of users who accepted.
create table public.event_attendees (
  event_id           uuid not null references public.opportunities(id) on delete cascade,
  user_id            uuid not null references public.users(id)         on delete cascade,
  invitation_id      uuid references public.event_invitations(id),
  status             public.attendee_status not null default 'joining',
  show_name_publicly boolean not null default false,
  joined_at          timestamptz not null default now(),
  primary key (event_id, user_id)
);
create index event_attendees_user_idx on public.event_attendees (user_id);


-- event_rooms: provider-agnostic chat metadata. One row per event, created on
-- first acceptance. chat_provider/chat_external_id/chat_invite_url are filled
-- by a worker after the actual chat is created on the provider's side.
create table public.event_rooms (
  event_id          uuid primary key references public.opportunities(id) on delete cascade,
  chat_provider     text,
  chat_external_id  text,
  chat_invite_url   text,
  chat_created_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index event_rooms_pending_provision_idx
  on public.event_rooms (created_at)
  where chat_provider is null;

-- updated_at maintenance (reuses public.set_updated_at from 0001b)
create trigger event_rooms_set_updated_at
  before update on public.event_rooms
  for each row execute function public.set_updated_at();


-- ─────────────────────────────────────────────────────────────────────────────
-- 5) score function — single source of truth for matching logic
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Hard filters return 0 (no row written by triggers).
-- Otherwise: interest-overlap count + audience bonuses (each +1 when user is
-- in target or target is empty/'any').
--
-- The company_preference ↔ identity_pref mapping is intentionally loose for
-- MVP (strict text-equality). Refine in app layer / future revision.
create or replace function public.compute_match_score(
  p_user_id        uuid,
  p_opportunity_id uuid
) returns numeric
language plpgsql
stable
as $$
declare
  u             public.users%rowtype;
  o             public.opportunities%rowtype;
  base_score    numeric := 0;
  overlap_count int;
begin
  select * into u from public.users         where id = p_user_id;
  if not found then return 0; end if;

  select * into o from public.opportunities where id = p_opportunity_id;
  if not found then return 0; end if;

  -- hard filter: same city (treat null cities as non-matching)
  if u.city is null or o.city is null or u.city <> o.city then
    return 0;
  end if;

  -- hard filter: opportunity must provide every accessibility flag user requires
  if not (u.accessibility_flags <@ o.accessibility_flags) then
    return 0;
  end if;

  -- base: interest overlap count
  select count(*) into overlap_count
  from unnest(u.interests) x
  where x = any(o.interests);
  base_score := overlap_count;

  -- audience bonus: age range
  if u.age_range is not null
     and array_length(o.target_age_range, 1) is not null
     and u.age_range = any(o.target_age_range) then
    base_score := base_score + 1;
  end if;

  -- audience bonus: identity / company preference (MVP: strict text match)
  if o.target_identity_pref <> 'any'
     and u.company_preference::text = o.target_identity_pref::text then
    base_score := base_score + 1;
  end if;

  -- audience bonus: veteran_status target list
  if u.veteran_status is not null
     and array_length(o.target_veteran_status, 1) is not null
     and u.veteran_status = any(o.target_veteran_status) then
    base_score := base_score + 1;
  end if;

  return base_score;
end;
$$;


-- ─────────────────────────────────────────────────────────────────────────────
-- 6) trigger functions + triggers
-- ─────────────────────────────────────────────────────────────────────────────

-- 6a) opportunities → match recompute
-- On insert/update of score-relevant columns: rebuild matches for this opportunity.
create or replace function public.opportunities_match_recompute()
returns trigger
language plpgsql
as $$
declare
  v_user  record;
  v_score numeric;
begin
  delete from public.event_matches where event_id = new.id;

  for v_user in
    select id from public.users where city is not distinct from new.city
  loop
    v_score := public.compute_match_score(v_user.id, new.id);
    if v_score > 0 then
      insert into public.event_matches (event_id, user_id, score, computed_at)
      values (new.id, v_user.id, v_score, now());
    end if;
  end loop;

  return new;
end;
$$;

create trigger opportunities_match_recompute
  after insert or update of
    city, interests, accessibility_flags,
    target_age_range, target_identity_pref, target_veteran_status
  on public.opportunities
  for each row execute function public.opportunities_match_recompute();


-- 6b) users → match recompute
-- On insert/update of score-relevant columns: rebuild matches for this user
-- against all future or timeless opportunities in their city.
create or replace function public.users_match_recompute()
returns trigger
language plpgsql
as $$
declare
  v_opp   record;
  v_score numeric;
begin
  delete from public.event_matches where user_id = new.id;

  for v_opp in
    select id from public.opportunities
    where city is not distinct from new.city
      and (start_at is null or start_at > (now() at time zone 'utc'))
  loop
    v_score := public.compute_match_score(new.id, v_opp.id);
    if v_score > 0 then
      insert into public.event_matches (event_id, user_id, score, computed_at)
      values (v_opp.id, new.id, v_score, now());
    end if;
  end loop;

  return new;
end;
$$;

create trigger users_match_recompute
  after insert or update of
    city, interests, accessibility_flags,
    age_range, company_preference, veteran_status
  on public.users
  for each row execute function public.users_match_recompute();


-- 6c) event_attendees → ensure event_rooms row exists
-- First acceptance for an event creates the room (chat_provider null until a
-- worker provisions Telegram and fills chat_external_id/chat_invite_url).
create or replace function public.event_attendees_create_room()
returns trigger
language plpgsql
as $$
begin
  insert into public.event_rooms (event_id)
  values (new.event_id)
  on conflict (event_id) do nothing;
  return new;
end;
$$;

create trigger event_attendees_create_room
  after insert on public.event_attendees
  for each row execute function public.event_attendees_create_room();


-- ─────────────────────────────────────────────────────────────────────────────
-- 7) RLS — owners read their own; writes go through service role
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.event_matches     enable row level security;
alter table public.event_invitations enable row level security;
alter table public.event_attendees   enable row level security;
alter table public.event_rooms       enable row level security;

-- event_matches: see your own candidate set only.
create policy "event_matches_self_read"
  on public.event_matches for select
  using (auth.uid() = user_id);

-- event_invitations: see your own; update only your own (app limits which
-- columns get touched — for now we trust the app to PATCH response only).
create policy "event_invitations_self_read"
  on public.event_invitations for select
  using (auth.uid() = user_id);

create policy "event_invitations_self_update"
  on public.event_invitations for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- event_attendees: see your own attendance rows.
create policy "event_attendees_self_read"
  on public.event_attendees for select
  using (auth.uid() = user_id);

-- event_rooms: visible to attendees of the same event.
create policy "event_rooms_attendees_read"
  on public.event_rooms for select
  using (
    exists (
      select 1 from public.event_attendees a
      where a.event_id = event_rooms.event_id
        and a.user_id = auth.uid()
    )
  );
