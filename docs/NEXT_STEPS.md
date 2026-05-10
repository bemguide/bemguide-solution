# Session Wrap-Up & Next Steps — 2026-05-10

What was shipped today, what's still required to make it work end-to-end, and where to look when something breaks. Branches diverge: `eugene/claude` carries Mini App + bot, `feature/backendops` carries the Node auth-backend. Both must merge to main eventually.

## What shipped today

### Backend (`feature/backendops`)

| Commit | What it does |
|--------|--------------|
| `3ddea43` | Diagnostic logging — boot fingerprint of `SUPABASE_URL` + SHA-256 prefix of each Supabase key; per-call `tag: "supabase_error"` line at every Supabase wrap site in `users.service.ts`. Made the rest of today's diagnoses possible. |
| `ae09956` | Switched `upsertOnboarding` + `maybeSetDisplayName` to `supabaseAdmin`. Root cause: HS256 session JWTs aren't PostgREST-verifiable (project signs ES256). |
| `758f604` | Same fix for the remaining four user-token call sites — `rooms.getForEvent`, `matches.listForUser`, `invitations.listForUser/respond`, `attendees.updateStatus`. Each preserves visibility filtering via explicit `.eq('user_id', userId)` or attendee-check. |
| `a2e9093` | New endpoint `GET /opportunities/:id/check-in-token` — short-lived HS256 JWT (`aud: 'check-in'`, payload `{event_id}`, TTL 600s default) for the QR-at-venue flow. Includes `verifyCheckInToken` helper for the future scanner-verify endpoint. |
| `74f5761` | New endpoint `POST /internal/event-rooms/attach` — HMAC-signed bot→backend write that fills `event_rooms` with `chat_external_id` + `chat_invite_url` after a user creates a Telegram group via the Mini App's deep-link. Encapsulated raw-body parser so the global JSON parser is unaffected. |

Plus on `feature/backendops` independently committed by you: `27d0447` (rsvp re-subscribe), `2b06b18` (matchmaking score loosening), `06c3529` (feed bucketing), `de7ea89` (tappable invite deep-link).

### Bot + Mini App (`eugene/claude`)

| Commit | What it does |
|--------|--------------|
| `0790f91` | Bot-side handler for the `?startgroup=event_<id>` deep-link. New helpers `hmacHex`, `attachChatToEvent`, `handleGroupAddedForEvent` in `supabase/functions/bot/index.ts`; group-context branch at the top of `/start` that bypasses `ensureVeteran` and runs the attach. Two new env getters (`backendBaseUrl`, `botInternalSecret`) in `_shared/env.ts`. |
| (`docs/EVENT_CHAT_ATTACH.md`) | Full protocol spec — bot, backend, Mini App, env vars, BotFather config, smoke-test checklist. Read this if any single layer breaks. |

## Pending action items (in order of dependency)

### 1. Set env vars (cannot ship without these)

**Bot — Supabase Edge Functions:**
```bash
SECRET=$(openssl rand -hex 32)   # generate ONCE; reuse below
supabase secrets set BOT_INTERNAL_SECRET="$SECRET" \
                     BACKEND_BASE_URL=https://bemguide-solution-production.up.railway.app
```

**Backend — Railway** (`auth-backend` service → Variables tab):
- `BOT_INTERNAL_SECRET` = same `$SECRET` value as above

**Mini App — Vercel/wherever `apps/web` deploys:**
- `NEXT_PUBLIC_TG_BOT_USERNAME` = your bot username without `@` (e.g. `bemguide_bot`)

### 2. Mini App "Створити чат" / "Відкрити чат" button

On `/m/event/<slug>`, gated by `GET /opportunities/:id/room` response state:

| Backend response | UI |
|------------------|----|
| 403 `not_attendee` | hide button — RSVP first |
| 200 with `chat_invite_url=null` | "Створити чат" → opens deep-link |
| 200 with `chat_invite_url=https://t.me/...` | "Відкрити чат" link |

```ts
window.Telegram.WebApp.openTelegramLink(
  `https://t.me/${process.env.NEXT_PUBLIC_TG_BOT_USERNAME}?startgroup=event_${eventId}`,
);
```

After tap, Telegram closes the Mini App; on return, poll `GET /opportunities/:id/room` for ~30s to detect attach completion (or just leave a "Refresh" button).

Spec: `docs/EVENT_CHAT_ATTACH.md` § "What's needed — Mini App side".

### 3. @BotFather one-time config

```
/setjoingroups → Enable      # bot can be added to groups
/setprivacy    → Disable     # bot reads /start in groups
```

Verify via `/mybots → @<your-bot> → Bot Settings`.

### 4. Smoke test the chat-attach flow

7-step checklist (also in `docs/EVENT_CHAT_ATTACH.md`):

1. RSVP `accepted` on a test event in the Mini App. Verify `event_rooms` row exists with `chat_provider=NULL` (via `mcp__supabase__execute_sql` or dashboard).
2. Tap "Створити чат" → Telegram opens group picker. Tap "New Group", confirm bot is pre-added, set a group name.
3. In the new group, **promote the bot to admin** (Telegram doesn't auto-promote on creation).
4. Re-tap "Створити чат" in the Mini App — re-triggers `/start event_<id>` in the group.
5. Edge Function logs (Supabase dashboard → Functions → bot → Logs) should show successful POST to `/internal/event-rooms/attach`.
6. `event_rooms.chat_invite_url` populated. Verify with:
   ```sql
   select chat_provider, chat_external_id, chat_invite_url from event_rooms where event_id = '<test-event-id>';
   ```
7. Mini App event page now shows "Відкрити чат" with the invite link.

### 5. Smoke test the check-in-token flow

```bash
TOKEN="<paste valid session JWT>"
EVENT_ID="<event you've RSVPed accepted to>"
curl -sS https://bemguide-solution-production.up.railway.app/opportunities/$EVENT_ID/check-in-token \
     -H "Authorization: Bearer $TOKEN"
# Expect: { "token": "eyJhbGc...", "expires_at": "..." }
```

Decode the token (paste into jwt.io or `cut -d. -f2 | base64 -d`) and verify:
- `aud: "check-in"` (NOT `"mini-app"` — that would mean it accidentally got minted as a session token)
- `sub: "<your user id>"`
- `event_id: "<the event id>"`
- `exp` ≈ 600s in the future

Try the same call against an event you haven't RSVPed to → expect `403 not_attendee`.

## Verification dashboard (when something breaks)

When the frontend shows an `upstream` error or a 5xx, the diagnosis order that worked today:

1. **Open Supabase API logs first** — `mcp__supabase__get_logs service="api"`. The HTTP `status_code` per call tells you immediately whether it's auth (401), schema (400/42703), RLS (403), or upstream (5xx).
2. **Check Railway logs** for `tag: "supabase_error"` lines. The `scope` field names the failing service function; the `error` object has the full PostgrestError; `status` confirms the class of failure.
3. **Check the boot fingerprint** for stale env keys — `service_role_key_fp`, `anon_key_fp`. Compare against your local `.env` using the helper in `docs/EVENT_CHAT_ATTACH.md` § "Verify before redeploying".

## Known gotchas (worth keeping in your head)

- **Branches share one repo but never converge.** `eugene/claude` and `feature/backendops` started from `1dccd95 scaffold` and have ~85 commits of divergence. Either merge them at some point or accept they stay parallel until something forces a merge. `feature/backendops` has zero `apps/`, `packages/`, `supabase/`; `eugene/claude` has zero `auth-backend/`.
- **`pino` typecheck error is pre-existing on `feature/backendops`.** `npx tsc --noEmit` reports `Cannot find module 'pino'` in `src/utils/logger.ts:1`. Production builds (Railway/tsx) tolerate it; the type-only check doesn't. One-line fix: `pnpm add -F auth-backend pino`. Worth a follow-up commit to keep typecheck green.
- **Migration filename collision at `0005`** — two files exist (`0005_drop_opportunities_slug.sql`, `0005_profiles_veteran_status.sql`); Supabase CLI applies the first by sort and silently skips the second. Renumber when you next touch migrations. Detail in memory `project_bemguide_schema_drift.md`.
- **`createChatForEvent` in `auth-backend/src/services/telegram.service.ts:123` is still a stub.** It's no longer reachable in the new chat-attach flow (chats arrive via push from the bot, not pull from the worker), but `provision-rooms.ts` worker would still hit it on cron — repurpose that worker for "nudge users with un-provisioned rooms" or remove its scheduled invocation.
- **`SUPABASE_SERVICE_ROLE_KEY` validation is `z.string().min(1)`.** A non-empty-but-invalid key boots cleanly and 401s every call. The boot fingerprint log makes it diagnosable in 30 seconds. Tightening to a JWT-shape regex is a worthwhile follow-up.

## Files map (quick reference)

```
auth-backend/
  src/
    config/env.ts                          ← env vars
    services/
      session.service.ts                   ← mintSessionJwt, mintCheckInToken,
                                             verifyCheckInToken, verifySessionJwt
      users.service.ts                     ← upsertOnboarding, getById, etc.
                                             (all migrated to supabaseAdmin)
      telegram.service.ts                  ← bot API wrappers; createChatForEvent
                                             stub (now unreachable in new flow)
    routes/
      auth/telegram.route.ts               ← POST /auth/telegram (initData → JWT)
      me/profile.route.ts                  ← PATCH /me/profile
      opportunities/
        check-in-token.route.ts            ← GET /…/check-in-token (NEW)
        room.route.ts                      ← GET /…/room
        rsvp.route.ts                      ← POST /…/rsvp
      internal/
        event-rooms-attach.route.ts        ← POST /internal/event-rooms/attach
                                             (NEW; HMAC-signed bot→backend)
    workers/
      dispatch-invitations.ts              ← cron: send invitation messages
      provision-rooms.ts                   ← cron: stub-creates chats (now legacy
                                             behaviour; consider repurposing)

supabase/functions/                        (eugene/claude only)
  bot/index.ts                             ← grammY bot, group-context handler (NEW)
  _shared/env.ts                           ← backendBaseUrl, botInternalSecret (NEW)

docs/                                      (eugene/claude only)
  EVENT_CHAT_ATTACH.md                     ← full protocol spec
  NEXT_STEPS.md                            ← this file
  V2_BACKEND_CONTRACT.md                   ← API surface
  V2_FRONTEND.md                           ← frontend conventions
  SCHEMA.md                                ← DB schema
```

## Reference: every notification the system sends

(From the Telegram side. See conversation earlier for full breakdown.)

| Type | Sender | When | Where |
|------|--------|------|-------|
| Invitation message | auth-backend `dispatch-invitations` worker | Cron-driven (frequency set externally; see worker comment) | `auth-backend/src/workers/dispatch-invitations.ts:120` |
| Group-attach confirm | bot Edge Function | When user creates event chat via deep-link | `supabase/functions/bot/index.ts` `handleGroupAddedForEvent` |
| `rsvp_confirm`, `reminder_24h`, `reminder_10m`, `post_event`, `event_published`, `moderation_decision`, `broadcast` | **Not implemented in this codebase.** Listed in `notification_type` enum, consumed by an unknown service (the `Deno/2.1.4 SupabaseEdgeRuntime` calls in the API logs operate on the legacy `notifications` + `veterans` tables). | — | — |
