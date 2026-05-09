-- 0002_rls.sql — RLS policies. Service role bypasses RLS by default; we expose a
-- tiny safe surface to anon/authenticated for the public event page.
-- Idempotent: each policy is dropped (if present) before being recreated.

alter table organizations enable row level security;
alter table veterans enable row level security;
alter table events enable row level security;
alter table rsvps enable row level security;
alter table ratings enable row level security;
alter table moderation_log enable row level security;
alter table notifications enable row level security;
alter table shares enable row level security;
alter table discovery_sources enable row level security;
alter table cities enable row level security;
alter table bot_sessions enable row level security;

-- cities: stable reference data, public read
drop policy if exists cities_read on cities;
create policy cities_read on cities
  for select
  using (true);

-- events: public read of approved events only
drop policy if exists events_public_read on events;
create policy events_public_read on events
  for select
  using (status = 'approved');

-- organizations: public read of verified orgs only
drop policy if exists orgs_public_read on organizations;
create policy orgs_public_read on organizations
  for select
  using (verified = true);

-- veterans, rsvps, ratings, moderation_log, notifications, shares,
-- discovery_sources, bot_sessions: NO anon/authenticated policies.
-- Service role (used inside edge functions) bypasses RLS and is the only writer.

-- =========================
-- public_rsvp_count: SECURITY DEFINER function so the public event page can
-- show counts and opt-in names without exposing the rsvps table directly.
-- =========================
create or replace function public.public_rsvp_count(p_event_id uuid)
returns table (going_count integer, names_visible text[])
language sql
security definer
set search_path = public
stable
as $$
  select
    count(*)::int as going_count,
    array_agg(v.display_name) filter (
      where r.show_name_publicly
        and v.show_name_publicly
        and v.display_name is not null
    ) as names_visible
  from public.rsvps r
  join public.veterans v on v.id = r.veteran_id
  where r.event_id = p_event_id
    and r.status = 'going';
$$;

grant execute on function public.public_rsvp_count(uuid) to anon, authenticated;
