# Event Chat Attach — User-Initiated Group Creation

When a user RSVPs `accepted` for an event, the backend's `event_attendees_create_room` trigger inserts a row into `event_rooms` with `chat_provider=NULL`. We need a Telegram group for that event so attendees can talk. **Telegram Bot API doesn't allow bots to create groups** — only users can. This doc describes the user-initiated flow that fills `event_rooms` after the user creates the group.

> **Status: ALL THREE LAYERS SHIPPED.** Mini App button (`db19d13` on `eugene/claude`), bot handler (`0790f91` on `eugene/claude`), backend endpoint (`74f5761` on `feature/backendops`). What's left is environment configuration — see "How to ship" below.

## Flow

```
┌──────────┐  1. tap "Створити чат"        ┌──────────┐
│ Mini App │ ────────────────────────────▶ │ Telegram │
│          │   openTelegramLink(            │  client  │
│          │   https://t.me/<bot>?          │          │
│          │   startgroup=event_<id>)       │          │
└──────────┘                                └────┬─────┘
                                                 │ 2. user picks "New Group" /
                                                 │    existing group, bot is
                                                 │    auto-added with the
                                                 │    `event_<id>` payload
                                                 ▼
                                            ┌─────────┐
                                            │   Bot   │  3. receives /start in
                                            │ (Edge   │     group context with
                                            │  Func)  │     match=event_<id>
                                            └────┬────┘
                                                 │ 4. exportChatInviteLink()
                                                 │    (requires bot is admin —
                                                 │    if not, asks user to
                                                 │    promote and re-trigger)
                                                 │
                                                 │ 5. POST /internal/event-rooms/
                                                 │    attach { event_id,
                                                 │              chat_id,
                                                 │              chat_invite_url }
                                                 │    + x-bot-signature header
                                                 ▼
                                       ┌──────────────────┐
                                       │  auth-backend    │  6. UPDATE event_rooms
                                       │  (Railway)       │     SET chat_provider,
                                       │                  │         chat_external_id,
                                       │                  │         chat_invite_url,
                                       │                  │         chat_created_at
                                       └──────────────────┘
                                                 │
                                                 ▼  7. /opportunities/:id/room
                                                    now returns the chat link;
                                                    Mini App's poller picks it
                                                    up and flips the button to
                                                    "Чат події"
```

## What was built — Mini App side (`eugene/claude` `db19d13`)

`apps/web/app/(miniapp)/m/event/[id]/EventChatButton.tsx` (~115 lines, new) plus a small wiring change in `EventActions.tsx` to thread `room` + `onRoomChange` into `AttendingBar`. Renders inside the sticky bottom bar when `attending.kind === "yes"`.

Two render branches driven by `room.chat_invite_url`:

- **`null`** → "Створити чат" → opens `https://t.me/<bot>?startgroup=event_<id>` via `Telegram.WebApp.openTelegramLink`. After tap, polls `GET /opportunities/:id/room` every 5s for 60s; flips to the open branch as soon as the bot reports the chat back. Falls back to `window.open` outside Telegram (dev/preview).
- **set** → "Чат події" → opens the invite URL via `openTelegramLink` so it lands inside Telegram's group-join prompt, not the browser.

Component-level details: see `docs/MINI_APP_CHAT_BUTTON.md`.

## What was built — bot side (`eugene/claude` `0790f91`)

`supabase/functions/bot/index.ts`:

- Group-context branch at the top of `bot.command("start")` — when `ctx.chat.type` is `group`/`supergroup` and the deep-link `param` matches `event_<id>`, runs the attach flow and skips `ensureVeteran` (group-adds aren't user-onboarding events).
- `handleGroupAddedForEvent`:
  1. Tries `ctx.exportChatInviteLink()`.
  2. If the bot isn't admin yet, replies in Ukrainian asking the user to promote it and re-trigger from the Mini App. Returns without erroring (best-effort, deliberately stateless — no `(chat_id ↔ event_id)` mapping table).
  3. POSTs JSON `{event_id, chat_id, chat_invite_url}` to `${BACKEND_BASE_URL}/internal/event-rooms/attach` with header `x-bot-signature: <hmac-sha256-hex(body, BOT_INTERNAL_SECRET)>`.
  4. On 2xx replies "Готово!"; on non-2xx replies a generic failure message and logs the response for diagnostics.

`supabase/functions/_shared/env.ts`: two new helpers — `env.backendBaseUrl()` and `env.botInternalSecret()`. Call-time-checked, so the new flow only fails on deploys that exercise it.

## What was built — auth-backend side (`feature/backendops` `74f5761`)

### Endpoint: `POST /internal/event-rooms/attach`

`auth-backend/src/routes/internal/event-rooms-attach.route.ts` (~130 lines, new).

**Headers:**
```
content-type: application/json
x-bot-signature: <HMAC-SHA256-hex of raw body, key = BOT_INTERNAL_SECRET>
```

**Body schema (Zod):**
```ts
{
  event_id:        z.string().uuid(),
  chat_id:         z.string().min(1).max(64),    // bot Chat IDs are negative
                                                 // bigints; pass as string
  chat_invite_url: z.string().url().max(512),
}
```

**Behaviour:**
1. Verify `x-bot-signature` against `env.BOT_INTERNAL_SECRET` with `crypto.timingSafeEqual` over the **raw** body bytes (captured by an *encapsulated* content-type parser so the global JSON parser used by every other route is untouched). 401 on mismatch.
2. Parse + validate body. 400 on malformed.
3. Confirm `event_id` exists in `public.opportunities`. 404 `opportunity_not_found` otherwise.
4. Refuse re-attaching a chat that's already bound to a *different* event (`.neq('event_id', event_id)` check). 409 `chat_already_attached_to_different_event`.
5. UPSERT `public.event_rooms` on `event_id`:
   - row may already exist (the `event_attendees_create_room` trigger inserts on first RSVP with `chat_provider=NULL`); we fill the chat fields here.
   - if no attendees yet, the upsert seeds the row.
6. Return `{ ok: true, room: <event_rooms row> }`.

**Errors to grep for:**
- 401 `bot_signature_invalid` — bad/missing header
- 404 `opportunity_not_found` — invalid `event_id`
- 409 `chat_already_attached_to_different_event` — chat already bound elsewhere

### Env

`auth-backend/src/config/env.ts`: new `BOT_INTERNAL_SECRET: z.string().min(16)` — must match the value set on the bot's Edge Function env.

## How to ship — env-only setup

Everything is on origin. To activate end-to-end:

### 1. Generate the shared HMAC secret (once)

```bash
openssl rand -hex 32
```

The same value goes in **three** places:
- Supabase Edge Functions env (for the bot)
- Railway env (for the auth-backend)
- Local `.env` if you want to develop either side against the production project

### 2. Set on Supabase Edge Functions (the bot)

```bash
supabase secrets set \
  BOT_INTERNAL_SECRET="<value>" \
  BACKEND_BASE_URL=https://bemguide-solution-production.up.railway.app
```

Or via the Supabase dashboard → Project Settings → Edge Functions → Manage secrets.

### 3. Set on Railway (auth-backend)

Railway dashboard → `auth-backend` service → **Variables** tab → add `BOT_INTERNAL_SECRET` with the same value as above. Railway redeploys automatically.

### 4. Set on the Mini App deploy

Vercel (or wherever `apps/web` is hosted) → environment variables → add:

```
NEXT_PUBLIC_TG_BOT_USERNAME=bembembem_testbot
```

(Bot username, no leading `@`. Already saved locally to `apps/web/.env.local` for dev.) If unset, `EventChatButton` renders nothing (deliberate — a button that silently does nothing is worse than no button).

### 5. @BotFather one-time

```
/setjoingroups   → Enable      # bot can be added to groups
/setprivacy      → Disable     # bot reads /start in groups (needed for
                                 the bot to see the startgroup payload)
```

Both are normally on by default for new bots, but verify via `/mybots → @<bot> → Bot Settings`.

### 6. Smoke test (7 steps)

1. RSVP `accepted` on a test event in the Mini App. Verify `event_rooms` row exists with `chat_provider=NULL`:
   ```sql
   select * from event_rooms where event_id = '<test-event-id>';
   ```
2. Tap "Створити чат" in the Mini App. Telegram opens its group picker.
3. Tap "New Group" (or pick an existing one). Bot is pre-added with the event payload. Set a group name.
4. **Promote the bot to admin** in the new group (Telegram doesn't auto-promote on creation). The bot will reply in Ukrainian asking for this if it doesn't already have admin rights.
5. Re-tap "Створити чат" in the Mini App — re-triggers `/start event_<id>` in the group context now that the bot is admin.
6. Edge Function logs (Supabase dashboard → Functions → bot → Logs) should show successful POST to `/internal/event-rooms/attach`.
7. `event_rooms.chat_invite_url` is now populated. The Mini App button auto-flips to "Чат події" within ~5s of the attach (the polling interval).

## Edge cases & known limitations

- **Bot must be admin to call `exportChatInviteLink`.** The `handleGroupAddedForEvent` reply in step 4 above is the user-facing flow when this fails. We do *not* listen for `my_chat_member` membership-change events to auto-retry on promotion — that would require a `(chat_id ↔ event_id)` mapping table, and the user re-triggers from the Mini App in one tap anyway. Stateless is cheaper.
- **Re-trigger creates a new primary invite link.** `exportChatInviteLink` revokes the previous primary invite. If you want stable links across re-triggers, switch to `createChatInviteLink` (returns a non-primary link without revoking) — minor change in `handleGroupAddedForEvent`.
- **One chat per event.** UPSERT semantics on `event_rooms.event_id` mean re-attaching a different chat overwrites the previous. The 409 check (`.neq('event_id', event_id)` on `chat_external_id`) prevents the *opposite* — one chat being aliased to multiple events. Two users race-creating two groups for the *same* event will see last-write-wins.
- **No deep-link from bot back into Mini App after group-add.** Telegram leaves the user in the new group, not back in the Mini App. The Mini App's polling logic recovers when the user returns.
- **Channels not supported.** `?startgroup=` only adds to groups/supergroups. For channels use `?startchannel=` and a separate handler — out of scope (we picked groups deliberately).

## Diagnostic order when something breaks

1. **Mini App button doesn't render** → check `NEXT_PUBLIC_TG_BOT_USERNAME` is set on the deploy. The component returns `null` when missing.
2. **"Створити чат" tap does nothing** → check `window.Telegram.WebApp.openTelegramLink` exists. Outside Telegram, the fallback `window.open` runs; in Telegram, the SDK should always be present.
3. **Group created but Mini App button stuck on "Чекаю на чат…"** → look at Supabase Edge Function logs for `bot` function. The POST to `/internal/event-rooms/attach` will be visible there with status code.
4. **Bot replies "Зробіть мене адміном…"** → expected; user needs to promote the bot to admin in the new group, then re-tap the Mini App button.
5. **Edge Function POST returns 401 `bot_signature_invalid`** → `BOT_INTERNAL_SECRET` mismatch between Supabase secrets and Railway. Re-run step 1-3 above; values must be identical.
6. **Edge Function POST returns 404 `opportunity_not_found`** → the `event_id` from the deep-link payload doesn't exist in `public.opportunities`. Probably a stale event_id in the URL the Mini App opened.
7. **Edge Function POST returns 409 `chat_already_attached_to_different_event`** → that Telegram chat is already bound to a different event in `event_rooms.chat_external_id`. Use a different chat or unbind the old one.

For backend-side errors that don't fit above: `mcp__supabase__get_logs service="api"` + grep Railway logs for `tag: "supabase_error"` (per `docs/NEXT_STEPS.md` § "Verification dashboard").

## Files (current state across both branches)

```
eugene/claude:
  apps/web/app/(miniapp)/m/event/[id]/
    EventChatButton.tsx          ✅ db19d13
    EventActions.tsx             ✅ db19d13 (+room/onRoomChange threading)
    ClientEventPage.tsx          ✅ already passes attending.room

  supabase/functions/bot/
    index.ts                     ✅ 0790f91 (group-context /start branch
                                              + handleGroupAddedForEvent)
  supabase/functions/_shared/
    env.ts                       ✅ 0790f91 (backendBaseUrl, botInternalSecret)

  docs/
    EVENT_CHAT_ATTACH.md         ← this file
    MINI_APP_CHAT_BUTTON.md      ✅ component-level notes
    NEXT_STEPS.md                ✅ session wrap-up

feature/backendops:
  auth-backend/src/routes/internal/
    event-rooms-attach.route.ts  ✅ 74f5761 (POST /internal/event-rooms/attach)
  auth-backend/src/config/
    env.ts                       ✅ 74f5761 (+BOT_INTERNAL_SECRET)
  auth-backend/src/
    app.ts                       ✅ 74f5761 (+route registration)
```

Branches share one repo but never converge — `eugene/claude` is bot + Mini App; `feature/backendops` is auth-backend. Both must merge to main eventually for the full system to land.
