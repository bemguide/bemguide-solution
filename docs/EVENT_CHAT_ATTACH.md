# Event Chat Attach — User-Initiated Group Creation

When a user RSVPs `accepted` for an event, the backend's `event_attendees_create_room` trigger inserts a row into `event_rooms` with `chat_provider=NULL`. We need a chat for that event so attendees can talk. **Telegram Bot API doesn't allow bots to create groups** — only users can. This doc describes the user-initiated flow that fills `event_rooms` after the user creates the group.

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
                                                    now returns the chat link
```

## What's done — bot side (this commit)

`supabase/functions/bot/index.ts`:

- New helpers `hmacHex`, `attachChatToEvent`, `handleGroupAddedForEvent` (~70 lines).
- Group-context branch at the top of `bot.command("start")`: when `ctx.chat.type` is `group`/`supergroup` and `param` starts with `event_`, runs `handleGroupAddedForEvent(ctx, eventId)` and returns. Skips `ensureVeteran` (group-adds are not user-onboarding events).
- `handleGroupAddedForEvent`:
  1. Tries `ctx.exportChatInviteLink()`.
  2. If the bot isn't admin yet, replies in Ukrainian asking the user to promote it and re-trigger from the Mini App. Returns without erroring (best-effort).
  3. POSTs the JSON `{event_id, chat_id, chat_invite_url}` to `${BACKEND_BASE_URL}/internal/event-rooms/attach` with header `x-bot-signature: <hmac-sha256-hex(body, BOT_INTERNAL_SECRET)>`.
  4. On 2xx replies "Готово!"; on non-2xx replies a generic failure message and logs the response for diagnostics.

`supabase/functions/_shared/env.ts`:

- Two new helpers: `env.backendBaseUrl()` and `env.botInternalSecret()`. Both required at call time (not at import) — so the new flow only fails if those vars are missing on a deploy that exercises it.

## What's needed — auth-backend side (not in this commit)

Branch this work onto `feature/backendops` (where the rest of the Node backend lives — `eugene/claude` has zero `auth-backend/` content).

### New endpoint: `POST /internal/event-rooms/attach`

**File:** `auth-backend/src/routes/internal/event-rooms-attach.route.ts` (new file; create `routes/internal/` directory)

**Headers:**

```
content-type: application/json
x-bot-signature: <HMAC-SHA256-hex of raw body, key = BOT_INTERNAL_SECRET>
```

**Body schema** (Zod):

```ts
{
  event_id: z.string().uuid(),
  chat_id: z.string().min(1),               // bot Chat IDs are negative bigints; pass as string
  chat_invite_url: z.string().url(),
}
```

**Auth**: verify `x-bot-signature` against the env-stored `BOT_INTERNAL_SECRET` using `crypto.timingSafeEqual`. No bearer needed — this endpoint is bot-to-backend only and never user-facing. Use the existing `verifyOneTimeLinkToken` pattern in `src/services/telegram.service.ts` as a model (it does the same HMAC dance).

**Behaviour:**

1. Verify signature; 401 on mismatch.
2. Parse + validate body; 400 on malformed.
3. Confirm `event_id` exists in `public.opportunities`; 404 `opportunity_not_found` otherwise.
4. UPSERT `public.event_rooms` on conflict `event_id`:
   ```sql
   UPDATE event_rooms
      SET chat_provider     = 'telegram',
          chat_external_id  = $chat_id,
          chat_invite_url   = $chat_invite_url,
          chat_created_at   = now(),
          updated_at        = now()
    WHERE event_id = $event_id
   -- if no row exists yet (no one has RSVPed), INSERT one.
   ```
5. Return `{ ok: true, room: <event_rooms row> }`.

**Errors to surface clearly** (so the bot's `attachChatToEvent` log line is actionable):

- 401 `bot_signature_invalid`
- 404 `opportunity_not_found`
- 409 `chat_already_attached_to_different_event` (if `chat_id` already exists on a _different_ event_id; rare, defensive)

### New env var: `BOT_INTERNAL_SECRET`

Add to `auth-backend/src/config/env.ts`:

```ts
BOT_INTERNAL_SECRET: z.string().min(16).default('placeholder-bot-internal-secret-change-me'),
```

Same value must be set on the bot's Edge Function env (`BOT_INTERNAL_SECRET`).

### Register route

`auth-backend/src/app.ts`:

```ts
import { eventRoomsAttachRoute } from "./routes/internal/event-rooms-attach.route.js";
// ...
await app.register(eventRoomsAttachRoute);
```

## What's needed — Mini App side

A button on the event-detail page (`/m/event/<slug>` per the existing routing in `bot/index.ts:42`):

```ts
// app/m/event/[slug]/EventChatButton.tsx (or wherever EventDetail lives)
"use client";

const onCreateChat = () => {
  const botUsername = process.env.NEXT_PUBLIC_TG_BOT_USERNAME!; // must be set
  const payload = `event_${eventId}`;
  window.Telegram.WebApp.openTelegramLink(`https://t.me/${botUsername}?startgroup=${payload}`);
};
```

**UI states** (driven off `GET /opportunities/:id/room`):

| State                                  | Backend response                            | Show                                       |
| -------------------------------------- | ------------------------------------------- | ------------------------------------------ |
| No room yet (user not RSVPed accepted) | 403 `not_attendee`                          | (button hidden — RSVP first)               |
| Room exists, chat not yet attached     | 200 with `chat_invite_url=null`             | "Створити чат" button → triggers deep-link |
| Room exists, chat attached             | 200 with `chat_invite_url=https://t.me/...` | "Відкрити чат" link/button                 |

After tapping "Створити чат", the Mini App is closed by Telegram. When the user returns, poll `GET /opportunities/:id/room` (every 3-5s for ~30s) to detect the attach completing — or just leave a "Refresh" button.

## What's needed — env vars

| Var                           | On bot (Edge Func env) | On auth-backend (Railway) | Value                                                 |
| ----------------------------- | ---------------------- | ------------------------- | ----------------------------------------------------- |
| `BACKEND_BASE_URL`            | ✅ required            | —                         | `https://bemguide-solution-production.up.railway.app` |
| `BOT_INTERNAL_SECRET`         | ✅ required            | ✅ required               | random 32+ char string, identical on both sides       |
| `NEXT_PUBLIC_TG_BOT_USERNAME` | —                      | — (Mini App env)          | bot username without `@` (e.g. `bemguide_bot`)        |

Generate `BOT_INTERNAL_SECRET`:

```bash
openssl rand -hex 32
```

Set on Supabase Edge Functions:

```bash
supabase secrets set BOT_INTERNAL_SECRET=<value> BACKEND_BASE_URL=https://...
```

Set on Railway: `auth-backend` service → Variables tab → `BOT_INTERNAL_SECRET=<same value>`.

## What's needed — @BotFather config (one-time)

```
/setjoingroups   → Enable      # bot can be added to groups
/setprivacy      → Disable     # bot reads non-command messages in groups
                                 (needed because /start in a group is a regular
                                 message the bot must see to extract the
                                 startgroup payload)
```

Both are normally on by default for new bots, but verify with `/mybots → @<bot> → Bot Settings`.

## Known limitations & edge cases

- **Bot must be admin to call `exportChatInviteLink`.** If the user creates the group but doesn't promote the bot, `handleGroupAddedForEvent` replies asking for promotion and bails. The user re-triggers from the Mini App after promoting. We don't auto-retry on `my_chat_member` membership-change events (deliberately — keeps the flow stateless, no `(chat_id → event_id)` mapping table needed).
- **Re-trigger creates a new invite link.** `exportChatInviteLink` revokes the previous primary invite. If you want stable links, switch to `createChatInviteLink` (returns a non-primary link without revoking) — minor change in `handleGroupAddedForEvent`.
- **One chat per event.** The backend's UPSERT semantics on `event_rooms.event_id` means re-attaching a different chat overwrites the previous. If two users race-create two groups for the same event, last-write-wins. If we want to prevent this, add a check: refuse attach when `chat_external_id` is already non-NULL.
- **No deep-link from bot back into Mini App after group-add.** Telegram's UX after group creation is to leave the user in Telegram (in the new group), not return them to the Mini App. So the Mini App's "waiting for chat" UI must self-recover via polling.
- **Channels not supported here.** `?startgroup=` only adds the bot to groups/supergroups. For channels use `?startchannel=` and a separate handler — out of scope for this commit since the choice is "groups only".

## What I need from you

Concrete checklist to ship this end-to-end:

- [ ] **Backend endpoint** — implement `POST /internal/event-rooms/attach` per the spec above on branch `feature/backendops`. Add `BOT_INTERNAL_SECRET` to `auth-backend/src/config/env.ts`. Register the route in `auth-backend/src/app.ts`. ~50 lines total.
- [ ] **Mini App button** — add the "Створити чат" / "Відкрити чат" button to the event-detail page, gated by `GET /opportunities/:id/room` response. Driven by `NEXT_PUBLIC_TG_BOT_USERNAME` env var.
- [ ] **Env vars on Supabase Edge Functions** — set `BACKEND_BASE_URL` and `BOT_INTERNAL_SECRET` (via `supabase secrets set` or dashboard).
- [ ] **Env var on Railway** — set `BOT_INTERNAL_SECRET` (same value).
- [ ] **Env var on Mini App deploy** — set `NEXT_PUBLIC_TG_BOT_USERNAME` to the bot username.
- [ ] **@BotFather** — confirm `/setjoingroups → Enable` and `/setprivacy → Disable` for the bot.
- [ ] **Smoke test**:
  1. RSVP accepted on a test event. Confirm `event_rooms` row exists with `chat_provider=NULL`.
  2. Tap "Створити чат" in Mini App; create a fresh test group.
  3. In the new group, promote the bot to admin.
  4. Re-trigger from Mini App (re-tap the button).
  5. Verify Edge Function logs show successful POST to `/internal/event-rooms/attach`.
  6. Verify `event_rooms.chat_invite_url` is now populated.
  7. Verify the Mini App's event page now shows "Відкрити чат" with the invite link.

## Files changed in this commit

- `supabase/functions/bot/index.ts` — new helpers + group-context branch in `/start`.
- `supabase/functions/_shared/env.ts` — two new env getters (`backendBaseUrl`, `botInternalSecret`).
- `docs/EVENT_CHAT_ATTACH.md` — this file.

## Files to create later (on `feature/backendops`)

- `auth-backend/src/routes/internal/event-rooms-attach.route.ts` (new)
- Diff to `auth-backend/src/config/env.ts` (+1 var)
- Diff to `auth-backend/src/app.ts` (+1 route registration)
