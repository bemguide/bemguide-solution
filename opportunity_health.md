# `opportunity_health` — schema reference

Static (always-on) health resources: rehab centers, recovery groups, healing
spaces. A sibling of `opportunities`, built for places people **visit on their
own time** rather than scheduled events.

- **Created by**: `supabase/migrations/0010_opportunity_health.sql`
- **Applied as**: migration `0010_opportunity_health` (remote + on-disk)
- **RLS**: enabled — public read, service-role write

---

## How it differs from `opportunities`

| Concern | `opportunities` | `opportunity_health` |
|---|---|---|
| Time | `start_at`, `ends_at`, `duration_min` | **None** — always-on |
| Interests | free-form `text[]` | enum `health_interest[]`, ≥1 required |
| Attendance | `event_attendees` join table (per-user RSVP, opt-in name list) | **Just a `visit_count` int** on the row |
| Discriminator | none | `type health_type` (currently always `'static'`) |
| Matchmaking | wired into `event_matches` via triggers | **not wired** — read directly by city / interest |
| Notifications | dispatched by `dispatch-invitations` worker | **none** — discovery-only |

---

## Columns

| Column | Type | Null | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `type` | `health_type` | NO | `'static'` | Discriminator. Single value today; extensible. |
| `title` | `text` | NO | — | Display name. |
| `short_description` | `text` | YES | — | Card preview copy. |
| `description` | `text` | YES | — | Full body copy. |
| `photo_url` | `text` | YES | — | Hero image. |
| `city` | `text` | NO | — | Primary discovery filter. |
| `oblast` | `text` | YES | — | Region (denormalised for display). |
| `address` | `text` | YES | — | Free-form street address. |
| `location_lat` | `numeric` | NO | — | Required for distance math. |
| `location_lng` | `numeric` | NO | — | Required for distance math. |
| `interests` | `health_interest[]` | NO | `'{}'` | **CHECK length ≥ 1.** See enum below. |
| `accessibility_flags` | `accessibility_flag[]` | NO | `'{}'` | Same enum as `opportunities`. |
| `target_age_range` | `age_range[]` | NO | `'{}'` | Same enum as `opportunities`. |
| `target_identity_pref` | `identity_pref` | NO | `'any'` | Same enum as `opportunities`. |
| `target_veteran_status` | `veteran_status[]` | NO | `'{}'` | Same enum as `opportunities`. |
| `price_uah` | `int` | YES | — | Null = "free" or "ask the venue." |
| `organizer_contact` | `text` | YES | — | Phone, Telegram handle, etc. |
| `visit_count` | `int` | NO | `0` | **CHECK ≥ 0.** Aggregate counter, no per-user history. |
| `created_at` | `timestamptz` | NO | `now()` | |
| `updated_at` | `timestamptz` | NO | `now()` | Maintained by `set_updated_at()` trigger. |

---

## Enums (new)

### `health_type`

Single value today; ready to grow.

| Value | Meaning |
|---|---|
| `static` | Always-on physical resource (rehab center, drop-in group). |

### `health_interest`

Strict, curator-controlled taxonomy. No free-form tags.

| Value | Meaning |
|---|---|
| `rehabilitation` | Physical / functional rehab — movement, prosthetics, physiotherapy. |
| `recovery` | Substance / behavioural recovery — addiction, support groups. |
| `healing` | Emotional / spiritual healing — trauma support, mindfulness, art therapy. |

The `CHECK (array_length(interests, 1) >= 1)` constraint forces every row to
declare at least one tag, so empty-tag rows can't slip into discovery and
silently become invisible.

---

## Indexes

| Name | Type | Columns | Purpose |
|---|---|---|---|
| `opportunity_health_pkey` | btree | `id` | Primary key. |
| `opportunity_health_city_idx` | btree | `city` | Discovery filter (city is required). |
| `opportunity_health_interests_gin` | GIN | `interests` | Array contains / overlaps queries (`@>`, `&&`). |
| `opportunity_health_accessibility_gin` | GIN | `accessibility_flags` | Array filtering for accessibility. |

GIN on a 3-value enum looks like overkill, but the index is tiny and PostgREST
filters like `interests=cs.{rehabilitation}` still benefit on cardinality
growth — no rewrite needed if you add values to the enum later.

---

## Triggers

| Trigger | Timing | Action |
|---|---|---|
| `opportunity_health_set_updated_at` | BEFORE UPDATE | Calls existing `public.set_updated_at()` to refresh `updated_at`. |

No matchmaking trigger. Unlike `opportunities` (which fires
`opportunities_match_recompute` to populate `event_matches`), health resources
are not personalised by score and have no `(user, opportunity_health)` cross-
table.

---

## RLS

```sql
alter table public.opportunity_health enable row level security;

create policy opportunity_health_public_read
on public.opportunity_health
for select
to anon, authenticated
using (true);
```

- **Read**: anyone — including unauthenticated clients (anon key).
- **Write**: service role only. The service role bypasses RLS, so no explicit
  insert/update/delete policy is needed.

This mirrors `opportunities`. If you add a curator role with self-service
inserts later, that's a new policy in a follow-up migration.

---

## Common queries

```sql
-- All recovery resources in Kyiv
select * from opportunity_health
where city = 'Київ' and interests @> array['recovery']::health_interest[];

-- Anything matching at least one of the user's needs
select * from opportunity_health
where city = $user_city
  and interests && array['rehabilitation','healing']::health_interest[];

-- Wheelchair-accessible recovery groups
select * from opportunity_health
where interests @> array['recovery']::health_interest[]
  and accessibility_flags @> array['wheelchair_accessible']::accessibility_flag[];

-- Atomic visit increment (call this from your write path)
update opportunity_health set visit_count = visit_count + 1 where id = $1;
```

PostgREST equivalents (anon/authenticated):

```
GET /rest/v1/opportunity_health?city=eq.Київ&interests=cs.{recovery}
GET /rest/v1/opportunity_health?interests=ov.{rehabilitation,healing}
```

---

## What this schema explicitly does NOT do

These are deliberate omissions, not gaps:

- **No personalised feed integration.** `feed.service.js` reads `event_matches
  × opportunities` only. To surface health resources in the feed, add a separate
  read path (e.g., a "near you / health" bucket built from city + interests),
  not new rows in `event_matches`.
- **No notifications.** `dispatch-invitations` worker only iterates
  `opportunities`. If you want push for health resources, that's a separate
  worker (or a generalised dispatcher).
- **No visit history.** `visit_count` is a single integer — no per-user record,
  no time series. To answer "which day was busiest?" you'd need a sibling
  `opportunity_health_visits` log table.
- **No bump RPC.** Increments happen via raw `UPDATE`. Wrap it in a function
  (`bump_opportunity_health_visit(id uuid)`) if you want stable contracts and
  rate-limit hooks.
- **No matchmaking.** Score-based ranking is a `opportunities`-only concept
  today. Health resources rank by city + interest filter, then probably distance.

---

## Likely follow-ups

| Task | Why | Ballpark |
|---|---|---|
| `bump_opportunity_health_visit(uuid)` RPC | Stable, anon-callable visit counter | 1 small migration |
| `GET /opportunity_health` Express route | Surface in web app via auth-backend | ~30 lines |
| Health-resource bucket in feed | If health resources should appear alongside events | new feed.service path |
| Visits log table + view | Only if you need history / analytics | non-trivial |
