# Current State & Runbook — 2026-05-10

> **Status: all dev work is shipped on origin.** No code remaining. This doc is now operational — what to set on each deploy environment to make the solution actually run, and what to check when something misbehaves.

## What's on origin (both branches up to date)

### `feature/backendops` — Node Fastify auth-backend

| Commit | What |
|--------|------|
| `74f5761` | `POST /internal/event-rooms/attach` — HMAC-signed bot→backend write that fills `event_rooms`. New env var `BOT_INTERNAL_SECRET`. |
| `a2e9093` | `GET /opportunities/:id/check-in-token` — short-lived HS256 JWT (`aud: 'check-in'`, TTL 600s) for QR-at-venue. |
| `758f604` | All remaining user-token data paths migrated to `supabaseAdmin` + explicit `user_id` filters. |
| `ae09956` | `upsertOnboarding` + `maybeSetDisplayName` migrated likewise (the route that surfaced the original bug). |
| `3ddea43` | Diagnostic logging — boot fingerprint of Supabase env, structured `tag: "supabase_error"` per call. |

### `eugene/claude` — Mini App + bot

| Commit | What |
|--------|------|
| `db19d13` | `EventChatButton` — Mini App component that opens the deep-link, polls for attach completion, switches to "Чат події" when ready. |
| `0790f91` | Bot's group-context `/start` handler in `supabase/functions/bot/index.ts`. New env getters `backendBaseUrl`, `botInternalSecret`. |
| `ed7286d` | Updated `docs/EVENT_CHAT_ATTACH.md` — full operational spec for the chat-attach flow. |

## Runbook — make it actually run

Three deploy environments need env values. Two of them share the same HMAC secret. Bot username is public.

### 1. Bot — Supabase Edge Functions

```bash
# Retrieve the secret from your local copy (gitignored, on this machine):
SECRET=$(grep '^BOT_INTERNAL_SECRET=' /Users/user/bemguide-solution/auth-backend/.env | cut -d= -f2)

supabase secrets set \
  BOT_INTERNAL_SECRET="$SECRET" \
  BACKEND_BASE_URL=https://bemguide-solution-production.up.railway.app
```

Or via Supabase dashboard → Project Settings → Edge Functions → Manage secrets.

After setting, redeploy the bot function:
```bash
supabase functions deploy bot
```

### 2. Auth-backend — Railway

Railway dashboard → `auth-backend` service → **Variables** tab → add:

| Var | Value |
|-----|-------|
| `BOT_INTERNAL_SECRET` | same value as Supabase secret above (retrieve with `grep '^BOT_INTERNAL_SECRET=' auth-backend/.env`) |

Railway redeploys automatically when env changes. No code push needed.

### 3. Mini App — Vercel (or wherever `apps/web` deploys)

Vercel project settings → Environment Variables → add:

| Var | Value |
|-----|-------|
| `NEXT_PUBLIC_TG_BOT_USERNAME` | `bembembem_testbot` |

Trigger a redeploy so the new value gets bundled into the client (`NEXT_PUBLIC_*` vars are baked at build time).

### 4. @BotFather — one-time bot config

```
/setjoingroups  → Enable      # bot can be added to groups
/setprivacy     → Disable     # bot reads /start in groups
```

Verify via `/mybots → @bembembem_testbot → Bot Settings`.

## Verify it's working

### Quick health probe

```bash
# Backend reachable + boot fingerprint visible:
curl -sI https://bemguide-solution-production.up.railway.app/health
# Expect: HTTP/2 200

# Bot username public lookup:
curl -sI https://t.me/bembembem_testbot | head -1
# Expect: HTTP/1.1 200 OK
```

### Full smoke test (chat-attach end-to-end)

In the Mini App as a real user:

1. RSVP `accepted` on a test event. Verify `event_rooms` row exists with `chat_provider=NULL`:
   ```sql
   select * from event_rooms where event_id = '<test-event-id>';
   ```
2. Tap **"Створити чат"** in the Mini App. Telegram opens its group picker.
3. Tap **"New Group"**, set a group name. Bot is pre-added with the event payload.
4. **Promote the bot to admin** in the new group. The bot replies asking for this if it's not promoted yet.
5. Re-tap **"Створити чат"** in the Mini App.
6. Edge Function logs (Supabase dashboard → Functions → bot → Logs) show successful POST to `/internal/event-rooms/attach`.
7. The Mini App button auto-flips to **"Чат події"** within ~5s. Tap it — opens the group's invite link in Telegram.

When step 7 succeeds, the flow is live end-to-end.

### Check-in QR end-to-end

```bash
TOKEN="<paste valid session JWT — get from Mini App's sessionStorage>"
EVENT_ID="<event you've RSVPed accepted to>"
curl -sS https://bemguide-solution-production.up.railway.app/opportunities/$EVENT_ID/check-in-token \
     -H "Authorization: Bearer $TOKEN"
# Expect: { "token": "eyJhbGc...", "expires_at": "..." }
```

Decode the returned JWT (paste at jwt.io or `cut -d. -f2 | base64 -d`) and verify:
- `aud: "check-in"` (NOT `"mini-app"` — that would mean it was minted as a session token by mistake)
- `sub: "<your user id>"`
- `event_id: "<the event id>"`
- `exp` ≈ 600s in the future

Test the not-an-attendee path:
```bash
EVENT_ID="<event you have NOT RSVPed to>"
curl -sS https://bemguide-solution-production.up.railway.app/opportunities/$EVENT_ID/check-in-token \
     -H "Authorization: Bearer $TOKEN"
# Expect: { "ok": false, "error": "not_attendee", ... } with HTTP 403
```

## Diagnostic dashboard — when something breaks

Order of operations that worked during today's debugging:

1. **`mcp__supabase__get_logs service="api"`** — shows every PostgREST request that reached Supabase. The HTTP `status_code` per call tells you the failure class immediately:
   - `401` → auth (bad service-role key, or HS256 user-token sent to ES256-signing PostgREST — see `feature/backendops` commits `ae09956`/`758f604`)
   - `400` with code `42703` → schema (column doesn't exist)
   - `403` → RLS (deny without policy match)
   - `5xx` → Supabase-side or trigger error
2. **Railway logs** — search for `tag: "supabase_error"`. The structured JSON has `scope` (which service function), `status` (HTTP code from PostgREST), full PostgrestError object, and call context (`telegramUserId`, `patch_keys`, etc.).
3. **Boot fingerprint in Railway logs** — search for `supabase env fingerprint at boot`. Shows `service_role_key_fp` (SHA-256 prefix), `anon_key_fp`, `supabase_url`. Compare against expected to detect stale keys after JWT secret rotation.

Per-symptom mapping for the chat-attach flow specifically: see `docs/EVENT_CHAT_ATTACH.md` § "Diagnostic order when something breaks".

## Reference values

Saved locally on this machine (gitignored, retrieve with `grep`):

| File | Var |
|------|-----|
| `auth-backend/.env` | `BOT_INTERNAL_SECRET` |
| `.env.local` (root) | `BOT_INTERNAL_SECRET`, `BACKEND_BASE_URL` |
| `apps/web/.env.local` | `NEXT_PUBLIC_TG_BOT_USERNAME=bembembem_testbot` |

| Public values | Value |
|---------------|-------|
| Bot username | `bembembem_testbot` |
| Bot deep-link prefix | `https://t.me/bembembem_testbot?startgroup=event_<id>` |
| Backend base URL | `https://bemguide-solution-production.up.railway.app` |
| Supabase project ref | `rwpzgsooevcmfcjaiqsy` |
| Supabase project URL | `https://rwpzgsooevcmfcjaiqsy.supabase.co` |

## Known gotchas (still standing)

- **Branches share one repo but never converge.** `eugene/claude` and `feature/backendops` started from `1dccd95 scaffold` and have ~85 commits of divergence. Either merge them at some point or accept they stay parallel until something forces a merge.
- **`pino` typecheck error is pre-existing on `feature/backendops`.** `npx tsc --noEmit` reports `Cannot find module 'pino'` in `auth-backend/src/utils/logger.ts:1`. Production builds (Railway/tsx) tolerate it; the type-only check doesn't. One-line fix: `pnpm add -F auth-backend pino`.
- **Migration filename collision at `0005`** — two files exist (`0005_drop_opportunities_slug.sql`, `0005_profiles_veteran_status.sql`); Supabase CLI applies the first by sort and silently skips the second. Renumber when you next touch migrations.
- **`createChatForEvent` in `auth-backend/src/services/telegram.service.ts:123` is now unreachable** — it was the *old* approach (worker creates the chat). Now chats arrive via push from the bot; this stub can be removed or repurposed for a "nudge users with un-provisioned rooms after N hours" worker.
- **`SUPABASE_SERVICE_ROLE_KEY` validation is `z.string().min(1)`.** A non-empty-but-invalid key boots cleanly and 401s every call. The boot fingerprint log makes it diagnosable in 30 seconds. Tightening to a JWT-shape regex is a worthwhile follow-up.

## Reference: every notification the system sends

| Type | Sender | When | Where |
|------|--------|------|-------|
| Invitation message | auth-backend `dispatch-invitations` worker | Cron-driven (frequency set externally) | `auth-backend/src/workers/dispatch-invitations.ts` |
| Group-attach confirm | bot Edge Function | When user creates event chat via deep-link | `supabase/functions/bot/index.ts` `handleGroupAddedForEvent` |
| `rsvp_confirm`, `reminder_24h`, `reminder_10m`, `post_event`, `event_published`, `moderation_decision`, `broadcast` | **Not implemented in this codebase.** Listed in `notification_type` enum, consumed by an unknown service operating on the legacy `notifications` + `veterans` tables. | — | — |

## Companion docs

- `docs/EVENT_CHAT_ATTACH.md` — full protocol spec for the chat-attach flow (read this when any layer of chat-attach breaks)
- `docs/MINI_APP_CHAT_BUTTON.md` — Mini App component specifics, state flow, render branches
- `docs/SCHEMA.md` — DB schema
- `docs/V2_BACKEND_CONTRACT.md` — backend API surface
- `docs/V2_FRONTEND.md` — frontend conventions
