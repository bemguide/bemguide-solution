# Supabase schema — primer for agents

Snapshot as of 2026-05-09. The DB has **two coexisting lanes**: a legacy
"v1" lane (predates the migration files in `supabase/migrations/`) and a
new "v2" lane that's been actively built out via migrations 0004 / 0005 /
0007 / 0008. They share a `public` schema but reference each other only
loosely (no v2→v1 FKs).

This file should give an agent enough to (a) extend the v2 lane safely,
(b) know what NOT to touch in v1, and (c) understand the key conventions
that aren't visible from `\d` alone.

---

## TL;DR

- Build new features against **v2** tables (`users`, `opportunities`,
  `event_matches`, `event_invitations`, `event_attendees`, `event_rooms`).
- The matchmaking pipeline is **trigger-driven and self-healing**:
  inserting/updating a `users` or `opportunities` row fans out matches
  automatically. Don't write to `event_matches` from app code.
- All v2 tables have **RLS enabled**, owner-read patterns, writes through
  service role.
- The "Telegram room" concept is **provider-agnostic in the DB** (no
  `tg_chat_id` columns); a worker fills `chat_provider` etc. after the fact.
- v1 tables (`veterans`, `events`, `rsvps`, `notifications`, etc.) are
  load-bearing for legacy code paths; **don't drop, don't retrofit, don't
  modify**. Bridge at the app layer if you need v1 data in v2.

---

## Lane overview

### v2 lane (built via migrations 0001/0001b/0002/0004/0005/0007/0008)

| Table                      | Purpose                                                                            | RLS                     |
| -------------------------- | ---------------------------------------------------------------------------------- | ----------------------- |
| `public.users`             | Onboarding profile (Q1–Q12), 1:1 with `auth.users`                                 | self-read/insert/update |
| `public.opportunities`     | Events + always-on opportunities (the [MAP][PLACE][INTEREST] surfaces)             | public read             |
| `public.event_matches`     | Precomputed (event, user) candidate set + score                                    | self-read               |
| `public.event_invitations` | Invite + delivery state + accept/decline response (1 row per (event,user), unique) | self-read; self-update  |
| `public.event_attendees`   | The "list" — users who accepted                                                    | self-read               |
| `public.event_rooms`       | Provider-agnostic chat metadata, 1:1 with opportunity                              | attendees-read          |

### v1 lane (out-of-band; not in our migration files)

These tables exist in the DB but were created outside the
`supabase/migrations/` flow. Treat as read-only legacy.

| Table                                                                                                   | Notes                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `public.veterans`                                                                                       | Legacy user-equivalent. **No FK to `auth.users.id`** — `veterans.id` is a free UUID. Don't assume `users.id == veterans.id`.                         |
| `public.events`                                                                                         | Legacy event model — richer than `opportunities` (has moderation pipeline, AI screening, recurrence, organizer/organizations).                       |
| `public.rsvps`                                                                                          | Accept/decline/deferred/attended for events. Already implements much of what `event_invitations`+`event_attendees` does, but keyed off `veteran_id`. |
| `public.notifications`                                                                                  | Outbound delivery queue (`pending`/`sent`/`failed`). `veteran_id NOT NULL` — can't write rows for v2 `users` without modifying it.                   |
| `public.bot_sessions`                                                                                   | Telegram bot conversational state (`flow`, `step`, `payload`). NOT a chat-room table.                                                                |
| `public.organizations`                                                                                  | Referenced by `events.organizer_id`. Schema not catalogued here.                                                                                     |
| `public.cities`, `public.discovery_sources`, `public.moderation_log`, `public.ratings`, `public.shares` | Supporting v1 tables. Schema not catalogued; query directly when needed.                                                                             |

### Tables in migration history but NOT in the DB

- `public.profiles` — created by `0001_profiles`, dropped at some point
  outside the migration flow. The enums it created (`verification_status`,
  `document_type`) and the function `public.set_updated_at()` survived.
  Don't try to re-create profiles unless you have a deliberate reason.

---

## v2 schema details

### `public.users` (created in 0007, telegram column added in 0008)

```
id                   uuid pk → auth.users(id) on delete cascade
email                text not null unique
city                 text                              -- Q1
display_name         text                              -- Q2
show_name_publicly   boolean default false             -- Q2
interests            text[] default '{}'               -- Q3, free-form
availability         text[] default '{}'               -- Q4, free-form
schedule_constraints text                              -- Q5
company_preference   company_preference default 'any'  -- Q6
accessibility_flags  accessibility_flag[] default '{}' -- Q7
triggers_to_avoid    text[] default '{}'               -- Q8 (free-form)
veteran_status       veteran_status                    -- Q9 (nullable)
role_in_group        text                              -- Q10
age_range            age_range                         -- Q11 (nullable)
bio                  text                              -- Q12
telegram_user_id     bigint unique                     -- nullable, links to TG
created_at, updated_at  timestamptz
```

Trigger: `users_match_recompute` fires AFTER INSERT or AFTER UPDATE OF
(`city`, `interests`, `accessibility_flags`, `age_range`,
`company_preference`, `veteran_status`).

### `public.opportunities` (created in 0004, slug dropped in 0005, audience-target columns added in 0008)

```
id                     uuid pk default gen_random_uuid()
title                  text not null
short_description, description, photo_url    text
city                   text not null
oblast, address        text
location_lat, location_lng  numeric(9,6) not null
start_at               timestamp                              -- (no tz, see "conventions")
duration_min           int
ends_at                timestamp generated always as (start_at + make_interval(mins => duration_min)) stored
interests              text[] default '{}'
accessibility_flags    accessibility_flag[] default '{}'
price_uah              int
organizer_contact      text
target_age_range       age_range[]      default '{}'           -- empty = no preference
target_identity_pref   identity_pref    default 'any'          -- reuses legacy enum
target_veteran_status  veteran_status[] default '{}'           -- empty = no preference
created_at, updated_at  timestamptz
```

Indexes:

- `(location_lat, location_lng)` — map viewport
- `(city, start_at) where start_at is not null` — timed events per city
- `(city) where start_at is null` — always-on per city
- GIN on `interests`
- GIN on `accessibility_flags`

Trigger: `opportunities_match_recompute` fires AFTER INSERT or AFTER
UPDATE OF (`city`, `interests`, `accessibility_flags`, `target_age_range`,
`target_identity_pref`, `target_veteran_status`).

### `public.event_matches` (created in 0008)

```
event_id    uuid → opportunities(id) on delete cascade
user_id     uuid → users(id)         on delete cascade
score       numeric  not null check (score > 0)
computed_at timestamptz
primary key (event_id, user_id)
```

Indexes: `(user_id, score desc)`, `(event_id, score desc)`. Only rows
with score > 0 are stored.

### `public.event_invitations` (created in 0008)

```
id              uuid pk
event_id, user_id    → opportunities/users on delete cascade
score_at_invite numeric
channel             text check in ('telegram','email','inapp')
channel_external_id text
scheduled_for, sent_at  timestamptz
delivery_status     invitation_delivery_status default 'pending'
failure_reason      text
retry_count         int default 0
responded_at        timestamptz
response            invitation_response   -- nullable until user responds
created_at          timestamptz
unique (event_id, user_id)               -- sticky decline
```

Workers poll: `select … where delivery_status = 'pending' and scheduled_for <= now()`.
The partial index `event_invitations_pending_dispatch_idx` makes that O(active).

### `public.event_attendees` (created in 0008)

```
event_id, user_id    → opportunities/users on delete cascade
invitation_id        → event_invitations(id)  -- which invite they accepted
status               attendee_status default 'joining'
show_name_publicly   boolean default false
joined_at            timestamptz
primary key (event_id, user_id)
```

Trigger: `event_attendees_create_room` fires AFTER INSERT — creates an
`event_rooms` row (with `chat_provider = null`) on first acceptance.

### `public.event_rooms` (created in 0008)

```
event_id          uuid pk → opportunities(id)
chat_provider     text          -- 'telegram', 'matrix', null = not provisioned
chat_external_id  text          -- provider's chat/room ID
chat_invite_url   text
chat_created_at   timestamptz
created_at, updated_at  timestamptz
```

Workers poll: `select … where chat_provider is null` (partial index
`event_rooms_pending_provision_idx` covers this).

---

## Functions

### `public.compute_match_score(p_user_id uuid, p_opportunity_id uuid) returns numeric`

Single source of truth for matching logic. Marked STABLE.

```
hard filter: city must match (returns 0 otherwise)
hard filter: user.accessibility_flags <@ opportunity.accessibility_flags
base:        cardinality(user.interests ∩ opportunity.interests)
+1:          if user.age_range ∈ opportunity.target_age_range
+1:          if user.company_preference::text == opportunity.target_identity_pref::text
             (loose mapping; refine in app layer)
+1:          if user.veteran_status ∈ opportunity.target_veteran_status
```

To add a new signal: edit this function, then add the relevant column to
the `update of (...)` clause of the triggers below.

### `public.set_updated_at()` (created in 0001, hardened in 0001b)

Generic `BEFORE UPDATE` trigger function. Reused by `users`, `opportunities`,
and `event_rooms`. Use for any new table that has an `updated_at` column.

---

## Enums

### v2-defined

- `accessibility_flag` _(actually defined out-of-band, used by v1 and v2;
  `0004` had to guard against re-creating it)_: 9 values
- `veteran_status`: 12 values (10 from Ukrainian veteran law + `in_process`,
  `no_docs`)
- `company_preference`: `with_partner | women_only | mixed | close_ones | any`
- `age_range`: `18_24 | 25_34 | 35_44 | 45_54 | 55_64 | 65_plus`
- `invitation_delivery_status`: `pending | sent | failed | cancelled`
- `invitation_response`: `accepted | declined | ignored`
- `attendee_status`: `joining | attended | no_show | left`

### v1-defined (still in use)

- `identity_pref`: `any | women_only | men_only | mixed_with_women_emphasis | family_friendly`
  _(referenced by `opportunities.target_identity_pref` — soft v2→v1 dependency)_
- `interest_category`, `event_source`, `event_status`, `notification_status`,
  `notification_type`, `rsvp_status`, `opportunity_type`,
  `document_type`, `verification_status`, `submission_status`,
  `discovery_channel`, `rating_score`, `rating_value` — used by v1 tables only.

---

## Conventions

### Timestamps

| Use case                                                                    | Type                | Why                                                                                                                                                                                                                  |
| --------------------------------------------------------------------------- | ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `opportunities.start_at`, `opportunities.ends_at`                           | `timestamp` (no tz) | `ends_at` is a `generated always as (...)` column and `timestamptz + interval` is `STABLE` not `IMMUTABLE`. Postgres rejects the generation expression. App layer is responsible for tz normalization on read/write. |
| Everything else (`created_at`, `updated_at`, `scheduled_for`, `sent_at`, …) | `timestamptz`       | System-managed. UTC by Supabase default.                                                                                                                                                                             |

**Don't "fix" `start_at` back to `timestamptz`** — it'll re-trigger the
generation-expression error.

### Array defaults

`'{}'::T[]` everywhere arrays appear. Empty array means "no value /
no preference". App code should treat `array_length(arr, 1) is null` as
the empty-set signal.

### Enum "any" values

`identity_pref` and `company_preference` both have an `any` value that
means "no preference". The matcher's audience bonus checks `<> 'any'`
before scoring — if the event says `any` or the user's preference matches
exactly, the bonus applies.

### RLS pattern

Default: enable RLS, add owner-read policy `auth.uid() = user_id`,
writes go through service role (which bypasses RLS). For tables with
"public read" semantics (like `opportunities`), use `using (true)`.

### Provider-agnostic chat columns

`event_rooms` uses `chat_provider`, `chat_external_id`, `chat_invite_url`
— not `tg_chat_id`. Adding a non-Telegram provider later means writing a
different `chat_provider` value; no schema migration needed.

---

## What's wired vs. what's not

### Wired (DB-level)

- Match recomputation on user/opportunity insert/update — automatic via triggers
- Room creation on first attendance — automatic via trigger
- `updated_at` maintenance — automatic via `set_updated_at()` triggers
- RLS policies on all v2 tables

### NOT wired (needs worker / app code)

- **Notification delivery**: nothing reads `event_invitations where
delivery_status = 'pending'` and sends Telegram messages. App workers
  must poll, send, then update `sent_at`/`delivery_status`/`failure_reason`.
- **Telegram room provisioning**: nothing reads `event_rooms where
chat_provider is null` and creates a Telegram chat. App workers must
  poll, create the chat, and write back `chat_provider`,
  `chat_external_id`, `chat_invite_url`, `chat_created_at`.
- **Invitation generation**: nothing decides _when_ to invite users for
  an event. The app layer reads `event_matches`, picks top N, inserts
  into `event_invitations` with `channel = 'telegram'` and `scheduled_for = now()`.
  The unique `(event_id, user_id)` constraint prevents double-invites.
- **Acceptance → attendees insert**: nothing turns
  `event_invitations.response = 'accepted'` into a row in `event_attendees`.
  This should be a worker / API endpoint that the app calls when a user
  taps "join" in the bot.
- **`telegram_user_id` linking**: nothing populates `users.telegram_user_id`
  from the bot's onboarding flow. Worker job: when bot sees a known auth
  user, write the link.

---

## Migration history (recorded in `supabase.migrations`)

```
0001_profiles                  -- enums + function survive; profiles table dropped out-of-band
0002_rls
0001b_harden_set_updated_at
0004_opportunities             -- after editing for ::timestamp + enum guard
0005_drop_opportunities_slug
0007_users
0008_event_matchmaking         -- v2 matchmaking (this layer)
```

`0003_storage_policies.sql`, `0005_profiles_veteran_status.sql`,
`0006_profiles_drop_verification.sql` exist on disk but are NOT applied.
The two latter files target `public.profiles` which doesn't exist —
attempting to apply will fail.

**Naming hazard**: `0005_drop_opportunities_slug.sql` and
`0005_profiles_veteran_status.sql` share a prefix on disk. `supabase db push`
ordering between same-prefix files is locale-dependent. If you keep both
files, rename one to a unique slot.

---

## Extending the matchmaker

### Adding a new match signal

1. Decide which side the signal lives on (user / opportunity / both).
2. Add column(s) via a new migration: `alter table public.users add column …`
   and/or `alter table public.opportunities add column …`.
3. Update `public.compute_match_score()` to factor the signal in (hard
   filter = early `return 0`; soft = `base_score := base_score + …`).
4. Add the new column to the `update of (...)` clause of the relevant
   trigger so rescores fire when it changes.
5. Backfill: `update public.opportunities set city = city` (no-op write
   that fires the trigger across every row) — repeat for users.

### Adding a new delivery channel

1. Update the `check (channel in (…))` constraint on `event_invitations`
   to include the new value.
2. Implement a worker that polls `event_invitations where
channel = 'newchannel' and delivery_status = 'pending'`.
3. No schema change needed beyond the check.

### Adding a new chat provider

No schema migration. Workers poll `event_rooms where chat_provider is null`,
provision via the new provider, write back `chat_provider = 'newprovider'`
and `chat_external_id = …`. The provider-agnostic columns absorb the change.

---

## Known drift / hazards

- `public.profiles` in migration history but not in DB.
- `public.veterans`, `public.events`, and ~10 other tables created
  out-of-band — not in `supabase/migrations/`. A `supabase db reset` would
  drop them and not recreate them.
- `accessibility_flag` enum was created out-of-band but is referenced by
  `0004_opportunities` (the migration has a `do $$ if not exists end $$`
  guard for this reason).
- Two `0005_*` migration files on disk; only one is applied.
- Bridging v1↔v2 is **app-layer only**. There is no schema-level
  guarantee that `users.id == veterans.id` for the same person.

---

## Workflow notes for agents using `mcp__supabase__*`

- **Always verify state before designing**: query `pg_type`,
  `information_schema`, and `mcp__supabase__list_migrations` first.
  Migration history doesn't always reflect what's in the DB.
- **`apply_migration` body must equal file body**: never silently send a
  modified SQL body. If you need to change the migration to make it
  apply, edit the file on disk first, re-Read it, then apply.
- **Destructive actions need plain-text user authorization**: even a
  `drop column` on a column you just added today. The auto-mode classifier
  may not honor `AskUserQuestion` answers as authorization for scope
  changes — get explicit text confirmation.
- **`set_updated_at()` is shared across both lanes** — adding a new
  table with `updated_at` is one trigger line away.

---

## Quick reference — useful queries

```sql
-- "What does this user match against?" (top 10)
select o.*, m.score
from public.event_matches m
join public.opportunities o on o.id = m.event_id
where m.user_id = '<uuid>'
order by m.score desc
limit 10;

-- "What's in the dispatch queue right now?"
select * from public.event_invitations
where delivery_status = 'pending' and scheduled_for <= now()
order by scheduled_for
limit 100;

-- "Which rooms need provisioning?"
select * from public.event_rooms where chat_provider is null;

-- "Force a rescore of all matches" (after compute_match_score change)
update public.opportunities set city = city;
update public.users         set city = city;
```
