# Supabase schema — primer for agents

> **Status note (this repo, 2026-05-09):**
> The migrations actually applied to our project ref `rwpzgsooevcmfcjaiqsy` are **only the v1 lane** (`supabase/migrations/0001_init.sql`, `0002_rls.sql`, `0003_pg_cron_notify.sql`). Everything below describing the **v2 lane** (`users`, `opportunities`, `event_matches`, `event_invitations`, `event_attendees`, `event_rooms`, plus migrations `0001b/0004/0005/0007/0008` and the `compute_match_score` function + matchmaking triggers) is **NOT yet implemented here** — it's the target schema. To add it, new migration files have to be written and pasted into Supabase Studio (same workflow we used for v1). When you do, follow the conventions documented in this file rather than improvising.
>
> The "v1 lane" in this primer maps 1:1 to what M2 created: `veterans`, `events`, `rsvps`, `notifications`, `bot_sessions`, `organizations`, `cities`, `discovery_sources`, `moderation_log`, `ratings`, `shares`. Those are the tables our M1–M15 stack reads/writes today.

---

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
  `discovery_channel`, `rating_score`, `rating_value` ...
