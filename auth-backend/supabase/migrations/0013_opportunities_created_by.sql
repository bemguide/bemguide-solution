-- Adds opportunities.created_by + auto-attendee trigger.
--
-- Why created_by (not organizer_id like v1 events): the v1 events table is no
-- longer queried by any active route; new convention follows Postgres "audit
-- trail of inserter" naming. Authorizes organizer-only endpoints
-- (POST /opportunities/:id/check-in).
--
-- Nullable on purpose: 146 existing rows have no source-of-truth for who
-- organized them. Route layer sets it on every new insert.
--
-- Trigger mirrors public.event_attendees_create_room (0008): AFTER INSERT,
-- ON CONFLICT DO NOTHING. The existing event_attendees_create_room trigger
-- will fire from this trigger's INSERT and create the room — no extra wiring.

alter table public.opportunities
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists opportunities_created_by_idx
  on public.opportunities (created_by);

comment on column public.opportunities.created_by is
  'User who created/organizes the event. Authorizes organizer-only endpoints '
  '(e.g. /opportunities/:id/check-in). Nullable to permit existing pre-feature '
  'rows to remain valid; new inserts via routes always populate it.';

create or replace function public.opportunities_create_organizer_attendee()
returns trigger
language plpgsql
as $$
begin
  if new.created_by is not null then
    insert into public.event_attendees (event_id, user_id, status, show_name_publicly)
    values (new.id, new.created_by, 'joining', false)
    on conflict (event_id, user_id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists opportunities_create_organizer_attendee on public.opportunities;
create trigger opportunities_create_organizer_attendee
  after insert on public.opportunities
  for each row execute function public.opportunities_create_organizer_attendee();
