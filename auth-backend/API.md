# auth-backend — API guide

Fastify + TypeScript backend for the v2 BemGuide Mini App. Implements the
contract in `V2_BACKEND_CONTRACT.md` against the v2 schema documented in
`SCHEMA.md`.

> **Quick reference** for routes only? Jump to [Route map](#route-map).
> **Want to run it?** Jump to [Local dev](#local-dev).
> **Hitting the live API?** Jump to [Auth flow](#auth-flow) → [Endpoints](#endpoints).

---

## Architecture

```
┌──────────────────────────┐    JSON     ┌──────────────────────────┐    service role
│ Telegram Mini App        │────────────►│ auth-backend (this)      │────────────────►┌─────────────┐
│ (Next.js, ngrok/Vercel)  │  Bearer     │ Fastify, port 8080       │   user-token    │  Supabase   │
└──────────────────────────┘             │                          │     (RLS)       │  (rwpzgsoo… │
                                         │  Workers (cron):         │                 │   project)  │
                                         │  - dispatch-invitations  │                 └─────────────┘
                                         │  - provision-rooms       │
                                         └──────────────────────────┘
                                                  │
                                                  ▼ outbound
                                          ┌──────────────────┐
                                          │ Telegram Bot API │
                                          │ Gemini API       │
                                          └──────────────────┘
```

- **Auth**: Telegram-only. The Mini App opens, fires
  `exchangeInitData(window.Telegram.WebApp.initData)` once, gets back an
  HS256 session JWT signed with `SESSION_JWT_SECRET`. All authed routes
  expect `Authorization: Bearer <token>`.
- **DB access**: two Supabase clients — `supabaseAdmin` (service role,
  bypasses RLS) for writes and worker reads, `supabaseAsUser(token)` for
  routes that should respect RLS (e.g. `GET /me/matches`,
  `GET /opportunities/:id/room`).
- **Workers**: one-shot CLI scripts invoked by external cron. Both support
  `DRY_RUN=1` to log intent without hitting Telegram.

---

## Conventions

| Concern     | Value                                                                                                                                                                 |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL    | `http://localhost:8080` (dev) / your deploy host                                                                                                                      |
| Encoding    | JSON in / JSON out (`Content-Type: application/json` on writes)                                                                                                       |
| Auth header | `Authorization: Bearer <token>`                                                                                                                                       |
| Casing      | `snake_case` field names matching the DB                                                                                                                              |
| Time        | `timestamptz` returned as ISO `…Z`. `opportunities.start_at` and `ends_at` are returned with `+03:00` (Europe/Kyiv) — frontend treats this as the canonical wire form |
| Pagination  | Cursor-based (`{cursor, next_cursor}`) on list endpoints; `/feed` returns ≤30 items in one shot                                                                       |
| CORS        | `localhost:3000`, `*.vercel.app`, `*.ngrok-free.{app,dev}` allowed; `Access-Control-Max-Age: 600`                                                                     |

### Error envelope

Errors return `{ ok: false, error, message, details? }` with these status codes:

| Status | Meaning                                 | Example `error` codes                                  |
| ------ | --------------------------------------- | ------------------------------------------------------ |
| 400    | Body shape / validation failed          | `validation_failed`, `invalid_init_data`               |
| 401    | Missing / invalid / expired token       | `unauthorized`, `expired`, `expired_init_data`         |
| 403    | Authed but not allowed                  | `forbidden`, `not_attendee`                            |
| 404    | Resource not found                      | `opportunity_not_found`, `user_not_found`, `not_found` |
| 409    | Conflict / race                         | `already_rsvped`, `event_started`, `conflict`          |
| 429    | Rate-limited                            | `rate_limited`                                         |
| 500    | Server error                            | `internal`                                             |
| 502    | Upstream (Supabase / Telegram / Gemini) | `upstream`                                             |

```json
{
  "ok": false,
  "error": "validation_failed",
  "message": "Invalid request body",
  "details": { "fieldErrors": { "interests": ["Array must contain at most 32 element(s)"] } }
}
```

---

## Auth flow

```
Mini App mount
    │
    │ POST /auth/telegram { init_data: window.Telegram.WebApp.initData }
    ▼
auth-backend
    │ verifyInitData (HMAC-SHA256 against TELEGRAM_BOT_TOKEN)
    │ getByTelegramId → public.users
    │ if absent: createUser (auth.users) + insertOnTelegramAuth (public.users)
    │ mintSessionJwt (HS256, sub=user.id, role='authenticated')
    ▼
{ token, expires_at, user }
    │
    ▼
Mini App stores token, sends as Bearer on every authed request
```

**Why HS256 and not Supabase's JWT?** Newer Supabase projects (ours
included) sign with **ES256**, with the private key in their KMS. We can
verify their tokens via the JWKS endpoint, but we can't reissue them. So
we sign our own session tokens with `SESSION_JWT_SECRET`. Tokens are valid
for `ACCESS_TOKEN_TTL_SECONDS` (default 24h). No refresh-token flow —
re-call `/auth/telegram` when the token expires (the bot token is stable;
re-issuing initData is cheap).

**`initData` HMAC algorithm** (per Telegram WebApp spec, in
`src/services/telegram-init.service.ts`):

```
1. Parse query string. Pull `hash` aside.
2. data_check_string = entries sorted by key, joined as "key=value\n"
3. secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
4. expected = HMAC-SHA256(secret_key, data_check_string)
5. timing-safe compare expected with provided hash
6. reject if auth_date older than TELEGRAM_INIT_DATA_MAX_AGE_SECONDS (24h)
```

---

## Route map

```
PUBLIC (no Authorization)
  GET    /health
  GET    /opportunities                     query: city, from, to, limit, cursor
  GET    /opportunities/:id                 + softAuth decoration
  GET    /opportunities/:id/attendees       count + opt-in names

AUTHED (Authorization: Bearer <token>)
  POST   /auth/telegram                     initData → session token
  GET    /me                                full V2User
  PATCH  /me                                Q1–Q12 onboarding
  GET    /me/profile                        alias of GET /me
  PATCH  /me/profile                        alias of PATCH /me
  POST   /me/telegram/link                  bot one-time-token flow
  GET    /me/matches                        cursor-paginated raw matches
  GET    /me/invitations                    cursor-paginated
  PATCH  /me/invitations/:id                accept / decline (legacy path)
  PATCH  /me/attendance/:eventId            joining → attended | no_show | left
  GET    /me/upcoming                       upcoming attendances + opportunities
  GET    /feed                              query: city; bucketed + decorated
  GET    /matches                           query: limit, cursor; {opp,score}[]
  POST   /opportunities                     create event
  POST   /opportunities/:id/rsvp            combined invitation+attendee+room
  PATCH  /opportunities/:id/attendee/show-name
  GET    /opportunities/:id/room

ADMIN (Authorization with role='admin' in JWT)
  PATCH  /opportunities/:id
  DELETE /opportunities/:id
  POST   /admin/opportunities               same as POST /opportunities
  GET    /admin/opportunities/:id/attendees full attendee list
```

---

## Endpoints

### `GET /health`

Returns `{ ok: true }`. No auth.

```bash
curl http://localhost:8080/health
# → {"ok":true}
```

---

### `POST /auth/telegram`

Verify Mini App initData, find or create user, issue session JWT.

|                |                                                                            |
| -------------- | -------------------------------------------------------------------------- |
| Auth           | Public                                                                     |
| Implementation | `src/routes/auth/telegram.route.ts`                                        |
| Service        | `src/services/telegram-init.service.ts`, `src/services/session.service.ts` |
| Rate limit     | Yes (auth window)                                                          |

**Request:**

```json
{ "init_data": "auth_date=…&user=%7B%22id%22%3A123%7D&hash=…" }
```

**Response 200:** `{ token, expires_at, user }` where `user` is the full
V2User shape (see [Data shapes](#data-shapes)).

```json
{
  "token": "eyJhbGciOi…",
  "expires_at": "2026-05-10T20:00:00.000Z",
  "user": {
    "id": "uuid",
    "email": "tg-123456789@poruch.local",
    "telegram_user_id": 123456789,
    "display_name": "Дмитро",
    "city": null,
    "interests": [],
    "company_preference": "any",
    "...": "..."
  }
}
```

**Errors:** `400 invalid_init_data`, `401 expired_init_data`, `409 conflict` (race), `500 internal`.

**Idempotent:** repeated calls with the same `init_data` (or a fresh one for
the same `telegram_user_id`) return the same `user.id`.

---

### `GET /me` / `GET /me/profile`

Return the bearer's full V2User row.

|                |                                                                  |
| -------------- | ---------------------------------------------------------------- |
| Auth           | Bearer required                                                  |
| Implementation | `src/routes/me/index.route.ts`, `src/routes/me/profile.route.ts` |

```bash
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/me
```

Returns the V2User. `404 user_not_found` if the row is missing (race).

---

### `PATCH /me` / `PATCH /me/profile`

Update Q1–Q12 onboarding fields. Triggers `users_match_recompute` when
score-relevant columns change (`city`, `interests`, `accessibility_flags`,
`age_range`, `company_preference`, `veteran_status`).

|                |                                                         |
| -------------- | ------------------------------------------------------- |
| Auth           | Bearer required (RLS self_update via user-token client) |
| Implementation | `src/routes/me/index.route.ts`                          |

**Request body** (all fields optional; partial update):

```ts
{
  city?: string | null;
  display_name?: string | null;
  show_name_publicly?: boolean;
  interests?: string[];                                // ≤32 items, ≤80 chars each
  availability?: string[];                             // ≤32 items
  schedule_constraints?: string | null;                // ≤2000 chars
  company_preference?: 'with_partner'|'women_only'|'mixed'|'close_ones'|'any';
  accessibility_flags?: AccessibilityFlag[];           // 9 enum values
  triggers_to_avoid?: string[];                        // ≤32 items
  veteran_status?: VeteranStatus | null;               // 12 enum values
  role_in_group?: string | null;
  age_range?: '18_24'|'25_34'|'35_44'|'45_54'|'55_64'|'65_plus' | null;
  bio?: string | null;                                 // ≤500 chars
}
```

**Response 200:** updated V2User.

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"city":"Київ","interests":["walks","coffee"],"age_range":"35_44"}' \
  http://localhost:8080/me
```

After this returns, `event_matches` for this user has been rebuilt. Verify:

```sql
select event_id, score from public.event_matches where user_id = '...' order by score desc;
```

---

### `POST /me/telegram/link`

Verify a one-time HMAC token minted by the bot, write
`users.telegram_user_id`. Used when a user originally registered via
another path and now links their Telegram identity.

> Less critical now that `/auth/telegram` is the only auth path —
> `telegram_user_id` is set at user creation. This endpoint stays for the
> case where the bot wants to add a TG identity to an existing user.

**Request:** `{ "token": "<base64url-payload>.<base64url-sig>" }`
**Response 200:** updated V2User.

---

### `GET /feed?city=<string>`

The personalised feed. The frontend's home screen.

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| Auth           | Bearer required                                            |
| Implementation | `src/routes/feed.route.ts`, `src/services/feed.service.ts` |
| Side-effects   | `Gemini API call (best-effort)`                            |

**Query:** `city` optional — defaults to user's `users.city`.

**Response 200:**

```json
{
  "today_tomorrow": [
    /* OpportunityCard[] */
  ],
  "this_week": [
    /* OpportunityCard[] */
  ],
  "try_new": [
    /* OpportunityCard[] */
  ]
}
```

Selection logic:

1. `event_matches` joined to `opportunities`, filter `score > 0`, optionally `city`
2. Sort `score desc, event_id asc`, take top 30
3. Bucket by `start_at`:
   - `today_tomorrow` — next 36h
   - `this_week` — 36h–168h
   - `try_new` — top 1–2 from the rest where interests don't overlap
4. Decorate each with `match_score`, `attendee_count`, `names_visible`,
   `distance_km` (always `null` — frontend computes), `ai_reason`
5. AI reasons via Gemini (one batched call). Failure mode: empty strings.

```bash
curl -H "Authorization: Bearer $TOKEN" "http://localhost:8080/feed?city=Київ"
```

---

### `GET /feed?filter=health|rehabilitation|discounts`

Topic-scoped flat feed, drawn from BOTH `opportunities` and `opportunity_health`
and merged into a single ranked list. Powers Mini App tabs "Здоров'я",
"Реабілітація", and "Знижки".

|                |                                                            |
| -------------- | ---------------------------------------------------------- |
| Auth           | Bearer required                                            |
| Implementation | `src/routes/feed.route.ts`, `src/services/feed.service.ts` |
| Side-effects   | None                                                       |

**Query**

| Field    | Required | Notes                                                          |
| -------- | -------- | -------------------------------------------------------------- |
| `filter` | yes      | Strict enum: `'health'` \| `'rehabilitation'` \| `'discounts'` |
| `city`   | no       | Defaults to `users.city`. Pass to override.                    |

**Response 200**

```ts
interface FilteredFeedResponse {
  filter: 'health' | 'rehabilitation' | 'discounts'; // echoed back
  items: FeedItem[]; // ≤30 rows total
}

type FeedItem =
  | (OpportunityCard & { source: 'opportunity' })
  | (OpportunityHealthCard & { source: 'opportunity_health' });
```

The two source tables are merged into one flat list, sorted by `match_score desc`,
capped at 30. **No time buckets** (unlike default `/feed`). The `source`
discriminator tells the frontend which renderer to use.

#### Tag clusters per filter

| Filter           | Includes (any of)                                   | Excludes (any of)                                 |
| ---------------- | --------------------------------------------------- | ------------------------------------------------- |
| `health`         | `recovery`, `psychological_support`, `medical_care` | `rehabilitation`, `art_therapy`, `equine_therapy` |
| `rehabilitation` | `rehabilitation`, `art_therapy`, `equine_therapy`   | —                                                 |
| `discounts`      | `discount_promotions`                               | —                                                 |

`health` and `rehabilitation` are **mutually exclusive on the query side**: a row
carrying any rehabilitation-cluster tag is dropped from the health response,
even if it also carries `medical_care` / `psychological_support`. So e.g.
"Іпотерапія" appears under `rehabilitation` only, never `health`.

#### `OpportunityCard`

```ts
interface OpportunityCard {
  source: 'opportunity';

  // identity
  id: string; // uuid
  title: string;
  short_description: string | null;
  description: string | null;
  photo_url: string | null;

  // location
  city: string;
  oblast: string | null;
  address: string | null;
  location_lat: number;
  location_lng: number;

  // schedule (opportunity-only)
  start_at: string | null; // ISO with "+03:00"; null = always-on
  ends_at: string | null;
  duration_min: number | null;

  // economics & contact
  price_uah: number | null;
  organizer_contact: string | null;

  // tagging
  interests: string[]; // legacy free-text array
  classified_interest: string[]; // strict enum
  accessibility_flags: AccessibilityFlag[];
  target_age_range: AgeRange[];
  target_identity_pref:
    | 'any'
    | 'women_only'
    | 'men_only'
    | 'mixed_with_women_emphasis'
    | 'family_friendly';
  target_veteran_status: VeteranStatus[];

  // audit
  created_at: string;
  updated_at: string;

  // decoration (added by /feed)
  match_score?: number; // count of classified_interest overlap with user
  attendee_count?: number;
  names_visible?: string[]; // ≤6 opt-in names
  distance_km?: number | null; // always null — frontend computes
}
```

#### `OpportunityHealthCard`

```ts
interface OpportunityHealthCard {
  source: 'opportunity_health';

  id: string;
  type: 'static';                                   // single value today; reserved for variants
  title: string;
  short_description: string | null;
  description: string | null;
  photo_url: string | null;

  // location (same as OpportunityCard)
  city: string;
  oblast: string | null;
  address: string | null;
  location_lat: number;
  location_lng: number;

  // NO schedule — health resources are evergreen.

  price_uah: number | null;                         // 0 = free, null = unspecified
  organizer_contact: string | null;
  visit_count: number;                              // analytics counter, ≥0

  interests: string[];
  classified_interest: string[];
  accessibility_flags: AccessibilityFlag[];
  target_age_range: AgeRange[];
  target_identity_pref: ...;
  target_veteran_status: VeteranStatus[];

  created_at: string;
  updated_at: string;

  match_score?: number;
  distance_km?: number | null;
}
```

#### Behaviour contract

1. **Past events excluded.** Opportunity rows with `start_at < now` are dropped.
   Undated (`start_at IS NULL`, "always-on") always pass. `opportunity_health`
   rows have no schedule and always pass.
2. **City filter.** When `city` is supplied (or inferred from user profile),
   only rows in that city are returned.
3. **Sorting.** `match_score desc`, with each table internally pre-ordered by
   `start_at asc nulls last` (opportunities) or `title asc` (opportunity_health)
   as a stable secondary key. Final list capped at 30 rows.
4. **`distance_km` always null** — frontend computes from city centroid + lat/lng.
5. **`names_visible` is opt-in × 2.** A name appears only if both the attendee
   AND the event opted in. Max 6 names.
6. **`opportunity_health` has no `attendee_count`/`names_visible`** — it's an
   evergreen resource, not an event.
7. **Cross-filter overlap is allowed.** A row may surface in the default feed
   (via e.g. `physical_sport`) AND in a filter (via e.g. `art_therapy`). This
   is intended — hybrid events should be discoverable from multiple paths. The
   only exclusion is `health` ↔ `rehabilitation`.

#### Errors

| Status | When                                                           |
| ------ | -------------------------------------------------------------- |
| 400    | `filter` not in the accepted enum, or `city` exceeds 120 chars |
| 401    | Missing/invalid bearer                                         |
| 404    | User profile not found (`code: user_not_found`)                |
| 502    | Upstream Supabase failure                                      |

All errors share `{ error: string, code?: string }`.

```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:8080/feed?filter=rehabilitation&city=Дніпро"
```

#### Live counts (post-v4 classifier, 2026-05-10)

| Filter           | Rows | Notes                                                             |
| ---------------- | ---- | ----------------------------------------------------------------- |
| `health`         | 26   | Pure medicine + psychology (clinics, psych support, sensor rooms) |
| `rehabilitation` | 40   | Rehab centres + therapy (art, equine, doll)                       |
| `discounts`      | 9    | Commercial promos only                                            |

---

### `GET /opportunities`

Public list of opportunities, cursor-paginated.

|       |                                                |
| ----- | ---------------------------------------------- |
| Auth  | Public                                         |
| Query | `city`, `from`, `to`, `limit` (≤100), `cursor` |

**Response 200:** `{ items: V2Opportunity[], next_cursor: string | null }`.

```bash
curl "http://localhost:8080/opportunities?city=Київ&limit=20"
```

Cursor is opaque (base64url-encoded `{ts, id}`). Pass back as `?cursor=…`.

---

### `POST /opportunities`

Create a new opportunity. Triggers `opportunities_match_recompute` —
`event_matches` populated for every matching user in the same city.

|      |                                                      |
| ---- | ---------------------------------------------------- |
| Auth | Bearer (any authenticated user — no moderation gate) |

**Request body** (all required fields enforced by zod):

```ts
{
  title: string;                                       // 1–200 chars
  short_description?: string | null;                   // ≤500
  description?: string | null;                         // ≤10000
  photo_url?: string | null;
  city: string;
  oblast?: string | null;
  address?: string | null;
  location_lat: number;                                // -90..90
  location_lng: number;                                // -180..180
  start_at?: string | null;                            // ISO with offset; backend strips tz
  duration_min?: number | null;
  interests?: string[];
  accessibility_flags?: AccessibilityFlag[];
  price_uah?: number | null;
  organizer_contact?: string | null;
  target_age_range?: AgeRange[];                       // [] = no preference
  target_identity_pref?: 'any'|'women_only'|'men_only'|'mixed_with_women_emphasis'|'family_friendly';
  target_veteran_status?: VeteranStatus[];
}
```

**Response 201:** the inserted V2Opportunity (with `+03:00` on `start_at`/`ends_at`).

> `ends_at` is a generated column (`start_at + duration_min minutes`) — never set it directly.

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "title": "Walk in Mariinsky Park",
    "city": "Київ",
    "location_lat": 50.4486,
    "location_lng": 30.5384,
    "start_at": "2026-05-15T18:00:00+03:00",
    "duration_min": 60,
    "interests": ["walks","coffee"]
  }' \
  http://localhost:8080/opportunities
```

---

### `GET /opportunities/:id`

Single opportunity. **Public** — works without auth (Михайло flow: a
shared Viber link opens in plain browser). With auth, decorated with
`match_score`.

|                |                                           |
| -------------- | ----------------------------------------- |
| Auth           | Optional (softAuth)                       |
| Implementation | `src/routes/opportunities/by-id.route.ts` |

**Response 200:** `OpportunityCard`. Without auth, `match_score` is omitted
(not `null`).

```bash
# unauthed
curl http://localhost:8080/opportunities/<id>

# authed — decorated
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/opportunities/<id>
```

---

### `PATCH /opportunities/:id` / `DELETE /opportunities/:id`

Admin-only. PATCH triggers `opportunities_match_recompute` if any
score-relevant column changes. DELETE cascades to
`event_matches`/`event_invitations`/`event_attendees`/`event_rooms`.

```bash
curl -X DELETE -H "Authorization: Bearer $ADMIN_TOKEN" \
  http://localhost:8080/opportunities/<id>
# → 204 No Content
```

---

### `GET /opportunities/:id/attendees`

**Public** count + opt-in display names. A name appears only when
**both** `event_attendees.show_name_publicly = true` AND
`users.show_name_publicly = true`.

```json
{ "count": 12, "names_visible": ["Олег", "Світлана", "Михайло"] }
```

Names cap: 12 in this endpoint. Anonymous attendees count toward `count`
but not `names_visible`.

---

### `POST /opportunities/:id/rsvp`

The **combined** RSVP operation. One call:

1. Optionally seeds `users.display_name` if user has none.
2. Upserts `event_invitations(event_id, user_id)` with response + `responded_at`.
3. If accepted: upserts `event_attendees` with `show_name_publicly`. The
   trigger `event_attendees_create_room` materialises an `event_rooms` row
   (with `chat_provider = null`).
4. If declined: existing attendee row's `status` set to `left` (no delete
   — preserves audit trail and `event_rooms`).
5. Returns the resulting `{ invitation, attendee, room }`.

**Refuses** with `409 event_started` if `start_at` is in the past.

A user who previously declined can re-subscribe — the existing
`event_invitations` row is updated with the new `response`. The dispatch
worker still won't re-ping them via Telegram unprompted, because its
insert path is on-conflict-do-nothing on the same `(event_id, user_id)`
row, so user-initiated re-subscription is allowed without reopening
the bot-side spam path.

**Request:**

```json
{
  "response": "accepted",
  "invitation_id": "uuid?",
  "display_name": "Дмитро",
  "show_name_publicly": true
}
```

**Response 200:**

```json
{
  "invitation": { "id": "...", "response": "accepted", "...": "..." },
  "attendee":   { "event_id": "...", "user_id": "...", "status": "joining", "..." },
  "room":       { "event_id": "...", "chat_provider": null, "..." }
}
```

`room` is `null` if no one has accepted yet (trigger hadn't fired).

---

### `PATCH /opportunities/:id/attendee/show-name`

Per-event privacy override. The user must already be an attendee.

**Request:** `{ "show": true }`
**Response 200:** `{ "status": "joining", "show_name_publicly": true }`
**Errors:** `403 not_attendee`.

---

### `GET /opportunities/:id/room`

Returns the chat room for an opportunity. RLS
(`event_rooms_attendees_read`) restricts to attendees — non-attendees see
`403 not_attendee`. Service-role-bypass is intentionally NOT used here.

**Response 200:** the V2EventRoom row.

```json
{
  "event_id": "uuid",
  "chat_provider": "telegram",
  "chat_external_id": "-100123456",
  "chat_invite_url": "https://t.me/+abcdef",
  "chat_created_at": "2026-05-09T20:30:00.000Z",
  "created_at": "...",
  "updated_at": "..."
}
```

If `chat_provider` is null, the room is awaiting the provisioning worker.
The frontend should poll until non-null.

---

### `GET /me/matches` and `GET /matches`

Both return raw `event_matches` (top-N by score) for the bearer.
`/me/matches` returns the cursor-paginated full list; `/matches?limit=20`
is the contract-compliant short-form.

```json
{
  "items": [
    {
      "score": 4,
      "opportunity": {
        /* V2Opportunity */
      }
    },
    {
      "score": 3,
      "opportunity": {
        /* V2Opportunity */
      }
    }
  ],
  "next_cursor": null
}
```

---

### `GET /me/invitations` / `PATCH /me/invitations/:id`

Cursor-paginated invitations + accept/decline. The PATCH handler is the
legacy path that the contract's combined `/opportunities/:id/rsvp`
supersedes — both still work.

---

### `PATCH /me/attendance/:eventId`

Update attendance status. Allowed transitions:
`joining → attended | no_show | left`. Anything else is `400 validation_failed`.

```bash
curl -X PATCH -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"status":"attended"}' \
  http://localhost:8080/me/attendance/<event_id>
```

---

### `GET /me/upcoming`

Lists `event_attendees` rows for the bearer where `opportunities.start_at`
is in the future (or `start_at` is null = always-on opportunity).

```json
{
  "items": [
    {
      "attendee":    { "status": "joining", "..." },
      "opportunity": { "title": "...", "start_at": "...+03:00", "..." }
    }
  ]
}
```

Sorted nearest-first; null `start_at` last.

---

## Data shapes

### V2User — `public.users`

```ts
{
  id: string;                                          // FK to auth.users.id
  email: string;
  city: string | null;                                 // Q1
  display_name: string | null;                         // Q2
  show_name_publicly: boolean;                         // Q2 default
  interests: string[];                                 // Q3 (free-form)
  availability: string[];                              // Q4
  schedule_constraints: string | null;                 // Q5
  company_preference: 'with_partner'|'women_only'|'mixed'|'close_ones'|'any';
  accessibility_flags: AccessibilityFlag[];            // Q7
  triggers_to_avoid: string[];                         // Q8
  veteran_status: VeteranStatus | null;                // Q9
  role_in_group: string | null;                        // Q10
  age_range: AgeRange | null;                          // Q11
  bio: string | null;                                  // Q12 (≤500)
  telegram_user_id: number | null;                     // bigint, unique
  created_at: string;                                  // ISO timestamptz
  updated_at: string;                                  // ISO timestamptz
}
```

### V2Opportunity — `public.opportunities`

```ts
{
  id: string;
  title: string;
  short_description: string | null;
  description: string | null;
  photo_url: string | null;
  city: string;
  oblast: string | null;
  address: string | null;
  location_lat: number;                                // numeric(9,6)
  location_lng: number;                                // numeric(9,6)
  start_at: string | null;                             // wall-clock + "+03:00"
  duration_min: number | null;
  ends_at: string | null;                              // generated; same +03:00
  interests: string[];
  accessibility_flags: AccessibilityFlag[];
  price_uah: number | null;
  organizer_contact: string | null;
  target_age_range: AgeRange[];                        // [] = no preference
  target_identity_pref: 'any'|'women_only'|'men_only'|'mixed_with_women_emphasis'|'family_friendly';
  target_veteran_status: VeteranStatus[];
  created_at: string;
  updated_at: string;
}
```

### OpportunityCard

`V2Opportunity` + decoration:

```ts
{
  ...V2Opportunity;
  match_score?: number;                                // omitted when unauthed
  ai_reason?: string;                                  // empty when GEMINI_API_KEY unset
  attendee_count: number;                              // joining + attended
  names_visible: string[];                             // ≤6, double opt-in
  distance_km: number | null;                          // always null (frontend computes)
}
```

### V2EventInvitation — `public.event_invitations`

```ts
{
  id: string;
  event_id: string; // → opportunities.id
  user_id: string; // → users.id
  score_at_invite: number;
  channel: 'telegram' | 'email' | 'inapp';
  channel_external_id: string | null; // e.g. Telegram message_id
  scheduled_for: string; // when the worker should send
  sent_at: string | null;
  delivery_status: 'pending' | 'sent' | 'failed' | 'cancelled';
  failure_reason: string | null;
  retry_count: number;
  responded_at: string | null;
  response: 'accepted' | 'declined' | 'ignored' | null;
  created_at: string;
}
```

### V2EventAttendee — `public.event_attendees`

```ts
{
  event_id: string;
  user_id: string;
  invitation_id: string | null; // which invite they accepted
  status: 'joining' | 'attended' | 'no_show' | 'left';
  show_name_publicly: boolean; // per-event override
  joined_at: string;
}
```

### V2EventRoom — `public.event_rooms`

```ts
{
  event_id: string; // PK = opportunity id
  chat_provider: 'telegram' | string | null; // null = awaiting worker
  chat_external_id: string | null;
  chat_invite_url: string | null;
  chat_created_at: string | null;
  created_at: string;
  updated_at: string;
}
```

### V2EventMatch — `public.event_matches`

```ts
{
  event_id: string;
  user_id: string;
  score: number; // > 0 (zero-score rows aren't stored)
  computed_at: string;
}
```

### Enums (frozen)

| Enum                         | Values                                                                                                                                                                                 |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `accessibility_flag`         | `barrier_free`, `no_stairs`, `quiet_room`, `no_alcohol`, `sign_language`, `audio_described`, `sensory_friendly`, `parking_disabled`, `service_animal_ok`                               |
| `age_range`                  | `18_24`, `25_34`, `35_44`, `45_54`, `55_64`, `65_plus`                                                                                                                                 |
| `attendee_status`            | `joining`, `attended`, `no_show`, `left`                                                                                                                                               |
| `company_preference`         | `with_partner`, `women_only`, `mixed`, `close_ones`, `any`                                                                                                                             |
| `identity_pref`              | `any`, `women_only`, `men_only`, `mixed_with_women_emphasis`, `family_friendly`                                                                                                        |
| `invitation_delivery_status` | `pending`, `sent`, `failed`, `cancelled`                                                                                                                                               |
| `invitation_response`        | `accepted`, `declined`, `ignored`                                                                                                                                                      |
| `veteran_status`             | `ubd`, `volunteer`, `active_duty`, `veteran`, `war_disabled`, `former_pow`, `family_of_fallen`, `family_of_missing`, `family_of_veteran`, `civilian_affected`, `in_process`, `no_docs` |

---

## Trigger-driven side-effects (DB level)

These fire automatically — the app never writes to these tables manually.

| Trigger                                                                                | Fires when                                                                                                                                | Effect                                                                                  |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `users_match_recompute`                                                                | INSERT or UPDATE of `users.{city, interests, accessibility_flags, age_range, company_preference, veteran_status}`                         | Rebuilds `event_matches` rows for this user against future opportunities in their city  |
| `opportunities_match_recompute`                                                        | INSERT or UPDATE of `opportunities.{city, interests, accessibility_flags, target_age_range, target_identity_pref, target_veteran_status}` | Rebuilds `event_matches` rows for this opportunity against all matching users           |
| `event_attendees_create_room`                                                          | INSERT into `event_attendees`                                                                                                             | Creates `event_rooms` row with `chat_provider = null` (idempotent on duplicate accepts) |
| `users_set_updated_at` / `opportunities_set_updated_at` / `event_rooms_set_updated_at` | UPDATE on those tables                                                                                                                    | Sets `updated_at = now()`                                                               |

> **Don't write to `event_matches` from app code.** All inserts go through
> the recompute triggers. The table has `check (score > 0)`, so manual
> inserts of zero-score rows fail.

---

## Workers

Both are one-shot CLI scripts — invoke from external cron (Fly cron, GitHub
Actions, Vercel cron, supabase pg_cron-into-webhook, etc.).

### `worker:dispatch` — invitation fan-out + Telegram delivery

```bash
npm run worker:dispatch          # actually sends Telegram messages
DRY_RUN=1 npm run worker:dispatch   # logs intent, no network
```

Two phases:

1. **Selection** — for every upcoming opportunity, pull top
   `INVITATIONS_TOP_N` (default 25) from `event_matches`, insert into
   `event_invitations` (`channel='telegram'`). The unique
   `(event_id, user_id)` constraint makes this idempotent.
2. **Delivery** — pull `event_invitations WHERE delivery_status='pending'
AND scheduled_for <= now()` (covered by partial index
   `event_invitations_pending_dispatch_idx`). For each: read user's
   `telegram_user_id`, send Telegram message, update `delivery_status`
   (`sent` or `failed`).

Sticky-decline preserved by the unique constraint — re-running the worker
won't re-invite anyone who declined.

### `worker:rooms` — Telegram chat provisioning

```bash
npm run worker:rooms
DRY_RUN=1 npm run worker:rooms
```

Reads `event_rooms WHERE chat_provider IS NULL` (covered by partial index
`event_rooms_pending_provision_idx`). For each: create a Telegram chat,
write back `chat_provider='telegram'`, `chat_external_id`,
`chat_invite_url`, `chat_created_at`.

> **Stub today**: real chat provisioning isn't wired (the Telegram Bot API
> doesn't expose programmatic group creation — the realistic flow is a
> bot-side admin action). Without `DRY_RUN`, the worker raises an
> `upstream` error. With `DRY_RUN=1`, it writes deterministic placeholders
> so you can exercise the rest of the pipeline.

### Recommended cron cadence

Both workers: every 1–5 minutes. They are cheap on idle (matched against
partial indexes) and idempotent on retry.

---

## Local dev

### Prereqs

- Node 20+
- `auth-backend/.env` populated (see [Env](#env))

### Common commands

```bash
cd auth-backend

npm install                       # one-time
npm run dev                       # tsx watch on port 8080
npm run build                     # tsc → dist/
npm start                         # node dist/server.js (prod-shaped)

npm run typecheck                 # tsc --noEmit
npm test                          # vitest run
npm run test:watch                # vitest watch

npm run lint                      # eslint
npm run format                    # prettier write

npm run worker:dispatch           # cron: invitation dispatch
npm run worker:rooms              # cron: room provisioning
```

### Env

Required for the backend to boot:

```bash
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=eyJ…           # for supabaseAsUser RLS clients
SUPABASE_SERVICE_ROLE_KEY=eyJ…   # for supabaseAdmin RLS-bypass

# Our session-signing secret (HS256). Generate: openssl rand -hex 32
SESSION_JWT_SECRET=
ACCESS_TOKEN_TTL_SECONDS=86400

# Telegram
TELEGRAM_BOT_TOKEN=
TELEGRAM_BOT_USERNAME=
TELEGRAM_LINK_SECRET=             # for /me/telegram/link HMAC
TELEGRAM_LINK_TOKEN_TTL_SECONDS=900
TELEGRAM_INIT_DATA_MAX_AGE_SECONDS=86400

# Worker tunables
INVITATIONS_TOP_N=25
DISPATCH_BATCH_SIZE=50
ROOMS_PROVISION_BATCH_SIZE=20
DRY_RUN=0

# Optional: ai_reason in /feed. Unset = empty strings.
GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.0-flash
```

Empty-string env values fall through to schema defaults. Empty
`SESSION_JWT_SECRET` uses a placeholder — fine for dev, not for prod.

---

## Quickstart: Mini App auth + RSVP

```bash
# 1. Boot
cd auth-backend && npm run dev &
sleep 2

# 2. Auth (in real Mini App, this comes from window.Telegram.WebApp.initData)
TOKEN=$(curl -s -X POST http://localhost:8080/auth/telegram \
  -H "Content-Type: application/json" \
  -d "{\"init_data\":\"$INIT_DATA\"}" | jq -r .token)

# 3. Onboard
curl -X PATCH http://localhost:8080/me \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"city":"Київ","interests":["walks","coffee"],"age_range":"35_44"}'

# 4. Get personalised feed
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/feed

# 5. RSVP to an opportunity
curl -X POST http://localhost:8080/opportunities/<id>/rsvp \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"response":"accepted","display_name":"Дмитро","show_name_publicly":true}'

# 6. Read the room (poll until chat_provider is non-null)
curl -H "Authorization: Bearer $TOKEN" http://localhost:8080/opportunities/<id>/room
```

---

## Tests

```bash
npm test
# ✓ tests/health.test.ts            (2 tests)
# ✓ tests/auth.telegram.test.ts     (3 tests)
#   ✓ verifies initData, creates user, returns token + V2User
#   ✓ idempotent: second call returns same user
#   ✓ rejects tampered initData with 400 invalid_init_data
```

The `tests/auth.telegram.test.ts` synthesizes a valid initData payload
using your `TELEGRAM_BOT_TOKEN`, then exercises the HMAC verify, find-or-
create branch, JWT minting, and `public.users` insert. Each test creates a
synthetic user (`tg-<random>@poruch.local`) and the `afterAll` hook
deletes it from `auth.users` — `public.users` cascades on FK.

Tests gate on `HAS_REAL_SERVICE_ROLE` (in `tests/helpers/supabase-test.ts`)
— they skip cleanly when secrets are unset, but the suite is green either
way.

---

## Schema reference

For DB structure, RLS policies, trigger definitions, and the
`compute_match_score` SQL: see `auth-backend/SCHEMA.md`.

For the original frontend contract that drove this implementation: see
`V2_BACKEND_CONTRACT.md` (the doc the frontend team handed us).
