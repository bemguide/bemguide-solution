# v2 backend contract — what the frontend needs

Audience: the team that owns the v2 schema (`docs/SCHEMA.md`), the bot, and any service that talks to Supabase with the service role.

This is the contract the Telegram Mini App + public event pages expect. Implement these endpoints (or names you prefer — just tell us the mapping) and the existing stub at `apps/web/lib/api/` swaps in by changing the `// PLACEHOLDER` constants and setting `NEXT_PUBLIC_API_BASE`.

---

## Where the frontend sits

```
┌───────────────────────────┐     HTTPS (JSON)
│ Telegram Mini App         │ ────────────────► ┌────────────────────┐
│ (Next.js 16, App Router,  │                   │ v2 backend (yours) │
│  apps/web, Vercel/ngrok)  │ ◄──── token ───── │  REST API          │
└───────────────────────────┘                   └────────────────────┘
                                                          │
                                                          ▼ service role
                                                  ┌──────────────┐
                                                  │   Supabase   │
                                                  │ (project ref │
                                                  │  rwpzgsoo…)  │
                                                  └──────────────┘
```

- The frontend never holds the service role key.
- The frontend never opens a direct PostgREST/realtime connection to Supabase. Everything goes through your REST API.
- Auth: Telegram initData → backend → opaque Bearer token → frontend.

---

## Conventions

- **Base URL** — one production host, one staging if convenient. Frontend reads it from `NEXT_PUBLIC_API_BASE` (single env var).
- **Encoding** — JSON in / JSON out (`Content-Type: application/json` on writes; `Accept: application/json` always).
- **Auth header** — `Authorization: Bearer <token>` on every authed endpoint. Token is opaque to the frontend.
- **Time** — return `timestamptz` ISO strings (`2026-05-09T14:30:00+03:00` or `Z`). For `opportunities.start_at` (which is `timestamp` without tz in the DB), return ISO with explicit `+03:00` — the frontend treats whatever you return as the canonical wire form and re-renders in `Europe/Kyiv`.
- **Casing** — `snake_case` field names matching `docs/SCHEMA.md`. Don't camelCase silently.
- **Pagination** — not needed for MVP. The feed returns ≤30 opportunities and never pages. Add if/when the backend grows past that comfortably.
- **CORS** — must allow:
  - `https://<vercel-prod>.vercel.app` (production)
  - `https://*.ngrok-free.dev` and `https://*.ngrok-free.app` (dev tunneling)
  - `http://localhost:3000` (local dev)
  - Methods: `GET, POST, PATCH, OPTIONS`
  - Headers: `Authorization, Content-Type, Accept, X-Telegram-InitData` (the last one only if you decide to accept it on every request instead of doing the upfront exchange)
  - `Access-Control-Max-Age: 600`

---

## Common response envelope

Successful: bare JSON of the documented shape. **No** `{ ok: true, data: ... }` wrapping — the frontend types are concrete shapes (see `apps/web/lib/api/types.ts`).

Error:

```json
{
  "ok": false,
  "error": "machine_readable_code",
  "message": "Human-readable, Ukrainian preferred for end-user-facing errors",
  "details": { "field": "explanation" }
}
```

`ok: false` is only present on errors. Use these status codes:

| Status | Meaning                           | Example `error` codes                                  |
| ------ | --------------------------------- | ------------------------------------------------------ |
| 400    | Body shape / validation failed    | `invalid_body`, `validation_failed`                    |
| 401    | Missing / invalid / expired token | `unauthorized`, `expired`                              |
| 403    | Authed but not allowed            | `forbidden`, `not_attendee` (room access without RSVP) |
| 404    | Resource not found                | `opportunity_not_found`, `user_not_found`              |
| 409    | Conflict / race                   | `already_rsvped`, `event_started`                      |
| 429    | Rate-limit                        | `rate_limited`                                         |
| 500    | Server error                      | `internal`                                             |

---

## Auth flow

Every Mini App open fires `exchangeInitData(window.Telegram.WebApp.initData)` once on mount. The backend:

1. Parses `init_data`, verifies the HMAC against `TELEGRAM_BOT_TOKEN` per [the official spec](https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
2. Rejects if `auth_date` is older than 24h.
3. Looks up `public.users` by `telegram_user_id`. If absent: create `auth.users` via `supabase.auth.admin.createUser({ email: "tg-<tg_id>@poruch.local", email_confirm: true })`, then insert `public.users` with `id = auth.users.id`, `email`, `display_name = first_name`, `telegram_user_id = <tg_id>`. Triggers fan out matches automatically.
4. Issues a session token (Supabase JWT signed with the project's JWT secret is recommended — same one PostgREST uses, so you can also expose direct PostgREST endpoints later if you want).

### `POST /auth/telegram`

Public. No `Authorization` header.

Request:

```json
{ "init_data": "auth_date=…&hash=…&user=%7B%22id%22%3A123…%7D" }
```

Response 200:

```json
{
  "token": "eyJhbGciOi…",
  "expires_at": "2026-05-10T14:30:00Z",
  "user": {
    "id": "uuid",
    "email": "tg-123@poruch.local",
    "city": null,
    "display_name": "Дмитро",
    "show_name_publicly": false,
    "interests": [],
    "availability": [],
    "schedule_constraints": null,
    "company_preference": "any",
    "accessibility_flags": [],
    "triggers_to_avoid": [],
    "veteran_status": null,
    "role_in_group": null,
    "age_range": null,
    "bio": null,
    "telegram_user_id": 123456789,
    "created_at": "…",
    "updated_at": "…"
  }
}
```

Errors: `400 invalid_init_data`, `401 expired_init_data`, `500 internal`.

---

## User endpoints

All require `Authorization: Bearer <token>`.

### `GET /me`

Returns the full `V2User` of the bearer's owner.

Response 200: same shape as `auth.user` above.
Errors: `401 unauthorized`.

### `PATCH /me`

Body is a partial `V2User`. Only these fields are accepted from the client (the rest are server-controlled):

```ts
{
  city?: string;
  display_name?: string;
  show_name_publicly?: boolean;
  interests?: string[];          // free-form per primer
  availability?: string[];       // free-form
  schedule_constraints?: string | null;
  company_preference?: "with_partner" | "women_only" | "mixed" | "close_ones" | "any";
  accessibility_flags?: AccessibilityFlag[];   // 9 enum values
  triggers_to_avoid?: string[];
  veteran_status?: VeteranStatus | null;       // 12 enum values
  role_in_group?: string | null;
  age_range?: AgeRange | null;
  bio?: string | null;
}
```

Response 200: full updated `V2User`.

Validation rules:

- `interests`: max 32 items, each ≤80 chars
- `bio`: ≤500 chars
- enum fields rejected if not a known value

Errors: `400 validation_failed`, `401 unauthorized`.

---

## Feed endpoints

### `GET /feed?city=<string>`

Authed. Returns three sections of opportunities, personalised for the bearer.

Selection logic (suggested):

- Source: `public.event_matches` joined to `public.opportunities`, filtered by `event_matches.user_id = current_user` and `score > 0`.
- If `?city=` supplied, additionally filter `opportunities.city = ?`. Default = the user's `city`.
- Sort: `score desc, start_at asc`.
- Take top 30.
- Bucket:
  - `today_tomorrow` — `start_at` within next 36h
  - `this_week` — `start_at` 36h–168h ahead
  - `try_new` — top 1–2 results outside the user's interests intersection (good for breaking the filter bubble; if no candidates, return `[]`)
- For each opportunity decorate with:
  - `match_score` (from `event_matches`)
  - `attendee_count` (count of `event_attendees` rows with `status` IN `('joining', 'attended')`)
  - `names_visible` — up to 6 display names where the attendee opted in AND the user opted in
  - `distance_km` — Haversine from the requesting user's city centroid to `(location_lat, location_lng)`. Frontend can also compute this client-side if you'd rather not, just say so.
  - `ai_reason` — optional 1-line "чому саме це" string. Free-form; can be empty.

Response 200:

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

`OpportunityCard` shape (from `apps/web/lib/api/types.ts`):

```ts
type OpportunityCard = V2Opportunity & {
  match_score?: number;
  ai_reason?: string;
  attendee_count?: number;
  names_visible?: string[];
  distance_km?: number | null;
};
```

Errors: `401 unauthorized`.

### `GET /opportunities/:id`

**Public** — must work without `Authorization` (Михайло flow: wife shares the link via Viber, opens in plain browser, no login). When called with a Bearer header, decorate with `match_score` and `attendee_count` etc.; without auth, return the public subset.

Response 200: `OpportunityCard`. With no auth header, omit `match_score`.

Errors: `404 opportunity_not_found`.

### `GET /opportunities/:id/attendees`

Public. Returns the count + opt-in names — same data the public event page renders under "Хто йде".

Response 200:

```json
{ "count": 12, "names_visible": ["Олег", "Світлана", "Михайло"] }
```

Privacy: include a name only when both `event_attendees.show_name_publicly = true` AND `users.show_name_publicly = true`.

---

## RSVP / invitation endpoints

All authed.

### `POST /opportunities/:id/rsvp`

Request:

```json
{
  "response": "accepted",
  "invitation_id": "uuid?",
  "display_name": "Дмитро",
  "show_name_publicly": true
}
```

Behaviour:

1. If `display_name` is present and the user has none, set `users.display_name`.
2. Upsert `event_invitations (event_id, user_id)` with `response`, `responded_at = now()`. Sticky decline (the unique constraint blocks repeat changes after `declined`).
3. If `response = 'accepted'`: insert / upsert `event_attendees (event_id, user_id)` with `invitation_id`, `status = 'joining'`, `show_name_publicly` from the request (defaults `false`). The `event_attendees_create_room` trigger fires automatically — return whatever `event_rooms` row exists at the end of the transaction.
4. If `response = 'declined'`: delete the matching `event_attendees` row (or set `status = 'left'` — your call, just be consistent). Don't delete `event_rooms`.

Response 200:

```json
{
  "invitation": {
    /* V2EventInvitation */
  },
  "attendee": {
    /* V2EventAttendee | null */
  },
  "room": {
    /* V2EventRoom | null */
  }
}
```

Errors: `400 validation_failed`, `401 unauthorized`, `404 opportunity_not_found`, `409 event_started`.

### `PATCH /opportunities/:id/attendee/show-name`

Per-event privacy override. Updates `event_attendees.show_name_publicly` (the global `users.show_name_publicly` is the user-default; this is the per-event override).

Request:

```json
{ "show": true }
```

Response 200:

```json
{ "status": "joining", "show_name_publicly": true }
```

Errors: `401 unauthorized`, `403 not_attendee` (no row for this (event, user)).

### `GET /opportunities/:id/room`

Authed. Only attendees may read. Returns `V2EventRoom` or `null` (room not yet provisioned).

Response 200:

```json
{
  "event_id": "uuid",
  "chat_provider": "telegram",
  "chat_external_id": "-100123456",
  "chat_invite_url": "https://t.me/+abcdef",
  "chat_created_at": "…",
  "created_at": "…",
  "updated_at": "…"
}
```

Errors: `401 unauthorized`, `403 not_attendee`, `404 no_room` (or just return `null` body — frontend handles both).

---

## Optional but useful

These would be nice if cheap; not required for the first cut.

- `GET /matches?limit=20` — top-N `event_matches` for the current user as an array of `{ opportunity, score }`. The feed already covers the common case but raw matches are handy for an "all matches" screen.
- `POST /opportunities` (authed) — veteran-submitted event proposal. Today our hackathon writes these to the v1 `events` table for moderation. If you want to handle moderation in the v2 lane (`opportunities` has no `status` column), tell us how new opportunities should be flagged as pending and how the admin tool reads them.
- `GET /me/upcoming` — list of upcoming `event_attendees` rows + their opportunities. Powers the `/m/me` "my events" tab.

---

## Background workers (not consumed by the frontend, but the frontend's UX assumes they exist)

The schema primer flags these as "not wired"; the frontend silently relies on them:

1. **Invitation dispatch**.
   - Poll `event_invitations WHERE delivery_status = 'pending' AND scheduled_for <= now()`.
   - Send the invite (Telegram message in our case) using the user's `telegram_user_id`.
   - Update `sent_at`, `delivery_status`, `failure_reason`. Retries up to 3.
   - Without this, accepted users never get the calendar / QR / "as you join" follow-up.

2. **Chat room provisioning**.
   - Poll `event_rooms WHERE chat_provider IS NULL`.
   - Create the Telegram supergroup (or whatever provider), invite the bot, get the invite link.
   - Write `chat_provider = 'telegram'`, `chat_external_id`, `chat_invite_url`, `chat_created_at`.
   - The frontend polls `GET /opportunities/:id/room` until non-null.

3. **Reminder schedule**.
   - When attendance is created, queue T-24h and T-10m reminder invitations (or whatever your `notifications` model is). The frontend doesn't trigger reminders client-side.

4. **Post-event survey**.
   - 24h after `opportunities.ends_at`, send a 👍 / 😐 / 👎 prompt to each attendee. Capture into whatever your rating store is — frontend is not in the loop here unless you want to surface ratings on the event page (then expose `GET /opportunities/:id/ratings`).

5. **`event_matches` upkeep**.
   - The DB triggers in 0008 already handle this — frontend doesn't have to ask anything to recompute. Just confirming that any user/opportunity write fires the recompute and the frontend's next `GET /feed` reflects the change.

---

## Environment the backend will need

You probably have these already; listing for completeness:

```
TELEGRAM_BOT_TOKEN           # for verifying initData HMAC
TELEGRAM_BOT_USERNAME        # for deep-link generation if you build invite messages
SUPABASE_URL                 # rwpzgsooevcmfcjaiqsy.supabase.co
SUPABASE_SERVICE_ROLE_KEY    # for RLS-bypassing reads + admin createUser
SUPABASE_JWT_SECRET          # if issuing Supabase JWTs as session tokens
GEMINI_API_KEY               # if the backend produces ai_reason strings server-side
```

---

## Decisions we need from you

Drop answers in this doc or reply here, and we wire the contract.

1. **Token format.** Supabase JWT (so the same token can be reused if we ever go direct-to-PostgREST), or your own opaque token? Either works on the frontend side.
2. **Token lifetime.** 24h? 7d? Something else? Inform `expires_at` in the auth response.
3. **Refresh.** Do you want a refresh-token flow, or do we just call `/auth/telegram` again when `expires_at` passes? Frontend default = call `exchangeInitData` again on expiry.
4. **`distance_km` source.** Frontend computes from city centroids client-side, or backend computes from real coords? We can do either; frontend has the centroid table already.
5. **`ai_reason`.** Backend generates per-feed-call (slow but personalised), or omits and the frontend leaves the chip empty (today's degraded fallback)?
6. **Public reads.** Confirm `/opportunities/:id` and `/opportunities/:id/attendees` work without auth. The Михайло persona's whole story depends on this.
7. **Veteran-submitted events.** How do they enter the v2 lane given `opportunities` has no `status`? Until you decide, the propose flow stays on v1 in our hackathon repo.
8. **CORS preflight cache.** OK with `Access-Control-Max-Age: 600`?
9. **Rate limiting.** Anything we should pre-emptively respect? If you'd rather not have us spam `/me` on every miniapp open, tell us how often it's safe.
10. **Error i18n.** Should `error.message` come back in Ukrainian only, or English (with Ukrainian rendered client-side)? We currently render it as-is.

---

## Quick acceptance checklist

When this is done, the frontend flips by:

1. Setting `NEXT_PUBLIC_API_BASE=https://<your-host>` in Vercel + `apps/web/.env.local`.
2. Replacing each `// PLACEHOLDER` constant in `apps/web/lib/api/{auth,users,feed,invitations}.ts` with the real path you publish.
3. Migrating page calls one-by-one (see `docs/V2_FRONTEND.md` for the order). The demo keeps working on the v1 lane until each page is moved.

If anything in this contract is impossible / inconvenient on your side, push back here — better now than after we've migrated three pages.
