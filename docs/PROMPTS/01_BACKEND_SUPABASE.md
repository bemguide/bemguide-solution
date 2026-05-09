# 01 — Backend / Supabase

> Prereq: прочитать `00_MASTER_BRIEF.md`. Этот файл — для backend-агента, который поднимает Supabase: schema, RLS, edge functions, seed.

## Prompt для агента

```
You are the backend engineer for "Поруч" — a veteran-events MVP for a 36-hour hackathon.

Stack: Supabase (Postgres 15+) for DB, Auth, Storage, Realtime. Edge Functions in Deno/TypeScript.
NO Airtable. NO other backends. Everything goes through Supabase.

Your job:
1. Build the schema with proper RLS policies (security-first — assume hostile clients).
2. Build edge functions for: bot webhook, RSVP create/cancel, ICS generation, notify scheduler (cron), and thin wrappers around Gemini calls (the actual prompts live in 02_AI_GEMINI.md — you implement the call infra).
3. Seed 30+ realistic events across 3 cities (Київ, Львів, Дніпро) + ghost RSVPs so social proof never looks empty on demo.
4. Make sure all timestamps are timezone-aware (Europe/Kyiv).
5. Write SQL migrations as numbered files in supabase/migrations/. Idempotent where possible.
6. Document every endpoint in supabase/functions/README.md with request/response shape.

Constraints:
- All UI text and seed data is in Ukrainian.
- Telegram user IDs are sensitive — never expose them to clients via REST. Always go through edge functions for veteran lookups.
- Privacy default: rsvps.show_name_publicly = false. Public event page can read counts but never names without explicit opt-in.
- Use service role only inside edge functions. Client uses anon key + JWT (Telegram initData verification on edge).

Deliverables for this phase:
- migrations/ (SQL files, see schema below)
- functions/ (Deno TS, see endpoints below)
- seed/ (TS scripts that populate via service role)
- README with deploy steps (supabase link, supabase db push, supabase functions deploy …)

Do NOT touch the frontend. Do NOT design the bot conversation flows (that's 04_TG_BOT.md).

Begin by writing a 10-bullet plan and waiting for tech-lead approval.
```

## Schema (полная) — `supabase/migrations/0001_init.sql`

> Скопируй блок целиком в первую миграцию. Названия таблиц на английском, контент — украинский.

```sql
-- =========================
-- enums
-- =========================
create type rsvp_status as enum ('going', 'declined', 'deferred', 'attended', 'no_show');
create type event_status as enum ('draft', 'pending', 'approved', 'rejected', 'archived');
create type event_source as enum ('organizer', 'veteran_submission', 'admin_seed');
create type rating_score as enum ('up', 'meh', 'down');
create type discovery_channel as enum ('go_partner', 'peer_share', 'family_share', 'flyer_qr', 'instagram', 'cold_search', 'cross_link', 'unknown');
create type accessibility_flag as enum (
  'barrier_free',           -- безбар'єрно
  'no_stairs',              -- без сходів
  'quiet_room',             -- тиха кімната
  'no_alcohol',             -- без алкоголю
  'sign_language',          -- з сурдоперекладом
  'audio_described',        -- з аудіоописом
  'sensory_friendly',       -- сенсорно дружнє
  'parking_disabled',       -- паркінг для авто з посвідченням
  'service_animal_ok'       -- з твариною супроводу
);
create type interest_category as enum (
  'movement',     -- рух / спорт
  'learning',     -- навчитися чомусь
  'community',    -- спільнота
  'craft',        -- творчість / ремесло
  'volunteering', -- волонтерити
  'walks',        -- просто пройтися
  'reading',      -- читання, розмови
  'family'        -- з родиною
);
create type identity_pref as enum ('any', 'women_only', 'men_only', 'mixed_with_women_emphasis', 'family_friendly');
create type notification_type as enum ('rsvp_confirm', 'reminder_24h', 'reminder_10m', 'post_event', 'event_published', 'moderation_decision', 'broadcast');
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
  type text,                       -- 'go', 'library', 'rehab_center', 'cafe', 'sport_club', etc.
  city text not null,
  oblast text,
  verified boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table veterans (
  id uuid primary key default gen_random_uuid(),
  tg_user_id bigint unique,        -- nullable: someone may register via web first
  display_name text,               -- "Дмитро" — first name only by policy
  city text,
  oblast text,
  interests interest_category[] not null default '{}',
  accessibility_flags accessibility_flag[] not null default '{}',
  identity_prefs identity_pref not null default 'any',
  comfort_notes text,              -- free-form, used by AI for "чому це для тебе"
  show_name_publicly boolean not null default false,
  reminders_enabled boolean not null default true,
  language text not null default 'uk',
  onboarded_at timestamptz,
  last_active_at timestamptz,
  created_at timestamptz not null default now()
);

create index veterans_tg_idx on veterans(tg_user_id);
create index veterans_city_idx on veterans(city);

create table events (
  id uuid primary key default gen_random_uuid(),
  slug text unique not null,                    -- for public URLs
  title text not null,
  short_description text,                       -- 1-line, AI-cleaned
  description text,                             -- full plain-language description
  organizer_id uuid references organizations(id),
  city text not null,
  oblast text,
  address text,                                 -- human-readable
  location_lat numeric(9,6),
  location_lng numeric(9,6),
  start_at timestamptz not null,
  duration_min integer not null default 60,
  recurrence text,                              -- 'once' | 'weekly' | 'monthly' (text for MVP)
  categories interest_category[] not null default '{}',
  identity_tag identity_pref not null default 'any',
  accessibility_flags accessibility_flag[] not null default '{}',
  honest_absences text[],                       -- ["сходи на вході, без пандуса", "немає тихої кімнати"]
  price_uah integer not null default 0,         -- 0 = бесплатно
  photo_url text,
  organizer_contact text,                       -- redundant with org.contact, but stored for snapshot
  source event_source not null default 'organizer',
  status event_status not null default 'pending',
  ai_screen_score numeric(3,2),                 -- 0..1 from gemini-moderate
  ai_screen_notes text,
  moderator_id uuid,                            -- references admin user; we'll store auth.users.id
  moderator_notes text,
  published_at timestamptz,
  created_by_veteran_id uuid references veterans(id),  -- if source = veteran_submission
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index events_city_start_idx on events(city, start_at) where status = 'approved';
create index events_status_idx on events(status);
create index events_slug_idx on events(slug);

create table rsvps (
  id uuid primary key default gen_random_uuid(),
  veteran_id uuid not null references veterans(id) on delete cascade,
  event_id uuid not null references events(id) on delete cascade,
  status rsvp_status not null default 'going',
  qr_token text unique,                         -- for offline self-check-in
  show_name_publicly boolean not null default false,  -- per-rsvp override
  reminders_enabled boolean not null default true,
  defer_until timestamptz,                      -- if status = 'deferred'
  is_ghost boolean not null default false,      -- seed data marker
  created_at timestamptz not null default now(),
  unique (veteran_id, event_id)
);

create index rsvps_event_idx on rsvps(event_id) where status = 'going';
create index rsvps_veteran_idx on rsvps(veteran_id);

create table ratings (
  id uuid primary key default gen_random_uuid(),
  rsvp_id uuid not null unique references rsvps(id) on delete cascade,
  score rating_score not null,
  peer_quote text,
  peer_quote_approved boolean not null default false,
  peer_quote_attribution text,                  -- "Олег" or null
  created_at timestamptz not null default now()
);

create table moderation_log (
  id bigserial primary key,
  event_id uuid not null references events(id) on delete cascade,
  moderator_id uuid,                            -- auth.users.id
  action text not null,                         -- 'approved', 'edited', 'rejected', 'requested_changes'
  notes text,
  diff jsonb,                                   -- snapshot of edits
  created_at timestamptz not null default now()
);

create table notifications (
  id bigserial primary key,
  veteran_id uuid not null references veterans(id) on delete cascade,
  type notification_type not null,
  payload jsonb not null,                       -- {event_id, message_text, …}
  scheduled_for timestamptz not null,
  sent_at timestamptz,
  status notification_status not null default 'pending',
  failure_reason text,
  created_at timestamptz not null default now()
);

create index notifications_due_idx on notifications(scheduled_for) where status = 'pending';

create table shares (
  id bigserial primary key,
  veteran_id uuid references veterans(id),     -- nullable: shared from public page
  event_id uuid not null references events(id) on delete cascade,
  channel text not null,                        -- 'telegram', 'viber', 'copy_link'
  created_at timestamptz not null default now()
);

create table discovery_sources (
  id bigserial primary key,
  veteran_id uuid not null references veterans(id) on delete cascade,
  channel discovery_channel not null,
  details jsonb,
  created_at timestamptz not null default now()
);

-- aux: city catalog so dropdowns are consistent
create table cities (
  slug text primary key,
  name_uk text not null,
  oblast text not null,
  population integer,
  is_demo_city boolean not null default false   -- highlight Київ/Львів/Дніпро for MVP demo
);
```

## RLS — `supabase/migrations/0002_rls.sql`

```sql
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

-- cities: public read
create policy cities_read on cities for select using (true);

-- events: public can read approved only; admins (service role) bypass
create policy events_public_read on events for select using (status = 'approved');

-- organizations: public can read approved orgs
create policy orgs_public_read on organizations for select using (verified = true);

-- veterans: NO public read. Only service role.
-- (Reads happen through edge functions that verify Telegram initData and return scoped data.)

-- rsvps: public can read counts via a SECURITY DEFINER function (see below). No row-level public read.
create or replace function public_rsvp_count(p_event_id uuid)
returns table (going_count integer, names_visible text[])
language sql
security definer
set search_path = public
as $$
  select
    count(*)::int,
    array_agg(v.display_name) filter (where r.show_name_publicly and v.show_name_publicly and v.display_name is not null)
  from rsvps r
  join veterans v on v.id = r.veteran_id
  where r.event_id = p_event_id and r.status = 'going';
$$;

grant execute on function public_rsvp_count(uuid) to anon, authenticated;

-- ratings: only via edge function. No direct policy.
-- moderation_log: only service role.
-- notifications: only service role.
```

## Seed — `supabase/seed/events.ts`

> Минимум 30 событий. Для каждого — реалистичные `start_at` в ближайшие 7-14 дней, разнообразие categories/identity_tag/accessibility_flags. Минимум 3 события явно `women_only`, минимум 3 — `barrier_free`, минимум 5 — `craft|community`, минимум 8 — `movement`.

Промпт seed-агенту:

```
Generate 30 realistic Ukrainian veteran-friendly events across Київ (12), Львів (10), Дніпро (8).
For each event:
- Title in Ukrainian, plain (e.g. "Футбол з ветеранами у парку Шевченка", "Жіноче ремесло — гончарство і кава").
- short_description: 1 sentence, no jargon, no English.
- description: 2-3 paragraphs, what to expect, who runs it, plain language.
- organizer: pick from a small set of seed orgs (5-7 orgs total: 2 ГО, 1 reab центр, 1 sport club, 2 libraries, 1 cafe).
- start_at: spread between today+1 day and today+10 days, between 10:00 and 20:00 Europe/Kyiv.
- categories: 1-2 from interest_category enum.
- identity_tag: mostly 'any', but tag 4-5 as 'women_only', 1-2 as 'family_friendly'.
- accessibility_flags: realistic mix; at least 8 events with full barrier_free + no_stairs + quiet_room.
- honest_absences: when accessibility is partial, list missing things (e.g. ["сходи на вході 3 сходинки", "туалет не адаптований"]).
- price_uah: 90% events 0; 10% небольшая стоимость 50-150.
- photo_url: use Unsplash placeholder URLs themed around community/sport/craft (no military imagery).
- status: 'approved' (already moderated).
- source: 'admin_seed'.

Then generate ghost RSVPs:
- For each event, create 2-7 ghost veterans (is_ghost=true) with realistic Ukrainian first names (Олег, Андрій, Тарас, Анна, Світлана, Катерина, Михайло, Ігор, Оксана, Юрій...).
- Ghost veterans have: display_name, city matching event city, show_name_publicly=true, plausible interests/accessibility flags.
- Ghost RSVP show_name_publicly=true so social proof renders on event page.

Output as TypeScript that uses @supabase/supabase-js with service role key from env.
```

## Edge Functions

### `functions/bot/index.ts` — Telegram webhook

Принимает webhook от Telegram, роутит в grammY-handler (см. `04_TG_BOT.md`). Здесь только инфра:
- Verify Telegram secret token (set on `setWebhook`).
- Lookup или создание `veterans` по `tg_user_id`.
- Передача в bot handler.

### `functions/rsvp-create/index.ts`

```
POST /rsvp-create
Auth: Telegram initData (header X-Telegram-InitData) OR JWT
Body: { event_id: uuid, defer_until?: ISO timestamp }
Behavior:
  1. Verify initData HMAC against TG_BOT_TOKEN.
  2. Lookup veteran by tg_user_id; create stub if missing.
  3. If defer_until present → status='deferred', schedule notification at defer_until-1day.
     Else → status='going', generate qr_token (random 32 chars), schedule reminders T-24h and T-10min.
  4. Return: { rsvp_id, qr_token, calendar_url (link to ics-generate), counts: {going_count, names_visible} }.
Errors:
  - 401 if initData invalid
  - 404 if event not found or not approved
  - 409 if rsvp already exists (return existing instead — idempotent)
```

### `functions/ics-generate/index.ts`

```
GET /ics-generate?rsvp_id=<uuid>&token=<qr_token>
Returns: text/calendar attachment for the event
- Includes VALARM 24h before start
- TZID Europe/Kyiv
- Description includes event description + organizer contact + "Згенеровано Поруч"
- File name: poruch-{slug}.ics
```

### `functions/notify-scheduler/index.ts` — cron (every 1 min)

```
Cron: */1 * * * *
Behavior:
  1. SELECT * FROM notifications WHERE status='pending' AND scheduled_for <= now() LIMIT 50.
  2. For each:
     a. Lookup veteran's tg_user_id.
     b. Compose message based on type:
        - rsvp_confirm: "Записав на '{title}', {date}. [Додати в календар] [Мій QR] [Як дістатися]"
        - reminder_24h: "Завтра {time} — '{title}'. {place}. {who_else_going_line if available}."
        - reminder_10m: "Через 10 хв старт. {meet_at_line if available — 'хлопці біля 2 виходу'}"
        - post_event: "Як було на '{title}'? 👍 нормально  😐 так собі  👎 не пішло"
     c. POST to Telegram sendMessage. Use inline_keyboard for buttons.
     d. Mark sent or failed. On failure, retry up to 3 times with backoff.
  3. For reminder_24h/reminder_10m: optionally call gemini-copy edge fn to personalize the social-proof line ("Олег і ще 3 хлопці підтвердили").
```

### Wrappers around Gemini

> Все актуальные prompts — в `02_AI_GEMINI.md`. Здесь backend-агент пишет только инфраструктуру.

```
functions/gemini-rank/      → POST {veteran_id, candidate_event_ids[]} → ordered list + per-event reason
functions/gemini-parse-event/ → POST {raw_text, veteran_id} → {parsed: EventDraft, missing: string[]}
functions/gemini-moderate/  → POST {event_id} → {score: 0..1, flags: string[], notes: string}
functions/gemini-copy/      → POST {kind: 'why_this' | 'reminder_24h' | 'reminder_10m' | 'description_clean', context: {…}} → string
```

Все четыре используют `_shared/gemini.ts` — единый клиент:
```ts
// supabase/functions/_shared/gemini.ts
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')!;
const MODEL_FAST = 'gemini-2.0-flash';
const MODEL_THINKING = 'gemini-2.0-flash-thinking-exp';

export async function geminiCall(prompt: string, opts: {
  model?: string; jsonSchema?: object; maxOutputTokens?: number;
}) {
  // POST to https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
  // With responseMimeType:application/json + responseSchema if jsonSchema provided.
  // Retry 2x on 5xx with 500ms backoff. Throw on 4xx.
}
```

## Cron jobs

Через `pg_cron` или Supabase scheduled functions:

| Cron | Edge function | Frequency |
|---|---|---|
| `notify-scheduler` | dispatches due notifications | every 1 min |
| `archive-past-events` | sets status='archived' on events with start_at + duration < now() - 7 days | every 1 hour |
| `enqueue-post-event-surveys` | finds rsvps where event ended >24h ago and no survey scheduled → inserts notification(type=post_event) | every 30 min |

## Acceptance criteria для backend-агента

- [ ] `supabase db push` проходит чисто на пустой проект.
- [ ] `supabase functions deploy` поднимает 8 функций (bot, rsvp-create, ics-generate, notify-scheduler, gemini-rank, gemini-parse-event, gemini-moderate, gemini-copy).
- [ ] Seed скрипт создаёт 30+ событий, 5-7 organizations, 100+ ghost RSVPs.
- [ ] Public anon с anon key может SELECT events WHERE status='approved' и вызвать `public_rsvp_count(event_id)`. Не может прочитать veterans.
- [ ] RSVP-create end-to-end: фейковый initData → новый rsvp + qr_token + расписанные notifications.
- [ ] README с deploy-инструкцией и списком env vars (`GEMINI_API_KEY`, `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`, `SUPABASE_SERVICE_ROLE_KEY`, `PUBLIC_BASE_URL`).
