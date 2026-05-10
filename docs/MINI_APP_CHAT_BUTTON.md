# Mini App — Event Chat Button

The "Створити чат" / "Чат події" button on the event-detail page (`/m/event/<id>`). Renders inside the sticky `AttendingBar` only when the user is `attending.kind === "yes"`. Closes the user-facing half of the chat-attach flow specified in `EVENT_CHAT_ATTACH.md`.

## Where it lives

- `apps/web/app/(miniapp)/m/event/[id]/EventChatButton.tsx` — new component (~115 lines)
- `apps/web/app/(miniapp)/m/event/[id]/EventActions.tsx` — modified: `AttendingBar` now takes `room` + `onRoomChange` props; renders `<EventChatButton>` between the QR primary button and the share/decline grid

## Render branches

Driven by `room.chat_invite_url`:

| Backend state | Button label | On tap |
|---------------|--------------|--------|
| `room?.chat_invite_url == null` | **"Створити чат"** | Opens `https://t.me/<bot>?startgroup=event_<id>` via `Telegram.WebApp.openTelegramLink`. Telegram closes the Mini App and opens the group-picker with the bot pre-added. |
| Polling after tap | **"Чекаю на чат…"** (disabled) | While polling. See timing below. |
| `room.chat_invite_url` set | **"Чат події"** | Opens the invite URL via `openTelegramLink` so it lands inside Telegram (group-join prompt), not the browser. |
| `NEXT_PUBLIC_TG_BOT_USERNAME` not set | (component returns `null`) | Hidden entirely. A button that silently does nothing is worse UX than no button. |

## How attach detection works

After "Створити чат" tap:

1. Component opens the deep-link via `Telegram.WebApp.openTelegramLink`. Telegram closes the Mini App.
2. `setPending(true)` flips the button label to "Чекаю на чат…" and disables it.
3. A `setInterval` poller starts:
   - Calls `getRoom(eventId)` every **5 s** (`POLL_INTERVAL_MS`).
   - Stops when `chat_invite_url` is non-null OR after **60 s** (`POLL_TIMEOUT_MS`).
4. On hit: `setRoom(fresh)` flips the local state, calls `onRoomChange(fresh)` so the parent's `attending.room` is also updated. Button switches to "Чат події" without a page reload.
5. On timeout: `setPending(false)`, button reverts to "Створити чат". User can re-tap (e.g., if they didn't promote the bot to admin yet — see "Edge cases" in `EVENT_CHAT_ATTACH.md`).
6. Transient `getRoom` errors during polling are swallowed; the loop continues. Errors during the user's group-creation are normal — the row may not exist yet.

## State flow

```
ClientEventPage           EventActions          AttendingBar          EventChatButton
─────────────────         ───────────────       ─────────────────     ─────────────────
attending: {kind:'yes',
            room: V2EventRoom|null}
        │
        │ attending={..}
        ▼
   <EventActions>
        │
        │ room={attending.room}
        │ onRoomChange={(r) =>
        │   onAttendingChange({
        │     kind:'yes', room:r})}
        ▼
   <AttendingBar>
        │
        │ initialRoom={room}
        │ onRoomChange={onRoomChange}
        ▼
   <EventChatButton>
        │
        │ tap "Створити чат"
        │ → openTelegramLink(...)
        │ → poll getRoom(id) for 60s
        │ → onRoomChange(fresh)  ─────────────────────────────────────▶ EventActions
        │                                                              ─────────────────
        │                                                              onAttendingChange(
        │                                                                {kind:'yes',
        │                                                                 room: fresh})
        │                                                                     │
        │                                                                     ▼
        │                                                              ClientEventPage
        │                                                              ─────────────────
        │                                                              setState updates
        │                                                              attending.room
```

The state is owned at the `ClientEventPage` level so any other component (the `WhoIsGoing` strip, future "members joined the chat" surfaces, etc.) sees the same fresh `room` reference.

## Required env

```bash
# Mini App deploy (Vercel for apps/web, or wherever)
NEXT_PUBLIC_TG_BOT_USERNAME=bembembem_testbot   # without the leading @
```

Already set locally in `apps/web/.env.local` (gitignored). If unset at build time, `EventChatButton` returns `null` and the button is invisible. There's intentionally no error toast — misconfigured prod env shouldn't surface to users; check the deploy logs / env-vars page.

## Backend dependencies

This component is a no-op without:

- **`POST /internal/event-rooms/attach`** on `feature/backendops` (commit `74f5761`). Without it, the bot's HTTP call after group creation fails and the polling never finds a populated `chat_invite_url`.
- **`GET /opportunities/:id/room`** returning a `V2EventRoom` row including `chat_invite_url`. Already shipped on `feature/backendops` (`758f604`).
- **`BOT_INTERNAL_SECRET`** set identically on both Supabase Edge Functions (the bot) and Railway (the auth-backend). See `EVENT_CHAT_ATTACH.md` § "What's needed — env vars".

## Outside-Telegram fallback

For local dev and preview environments where `window.Telegram.WebApp.openTelegramLink` isn't injected, `openTgLink` falls back to `window.open(url, '_blank', 'noopener')`. The deep-link still opens in Telegram if the user has it installed (the OS handles the `https://t.me/...?startgroup=...` URL). The polling logic is identical regardless of where the click landed.

## Visual placement

Inside the `attending.kind === "yes"` sticky bottom bar:

```
┌────────────────────────────────────┐
│        [Показати QR]               │  ← primary, h-12 (existing)
│        [Створити чат / Чат події]  │  ← outline, h-11 (new)
│  [Поділитися]   [Не зможу]         │  ← outline grid (existing)
│  Анонімно · натисни щоб показати   │  ← privacy toggle (existing)
└────────────────────────────────────┘
```

Outline variant + `MessageCircle` lucide icon makes it visually distinct from the primary check-in CTA without competing for attention. Same height as the share/decline row for grid consistency.

## What I didn't do (deliberately)

- **No `visibilitychange` listener.** When the user returns from Telegram, the Mini App may or may not re-render depending on platform (iOS Telegram aggressively unmounts; Android holds state). The interval poller covers both cases without needing platform-specific handling.
- **No "manual refresh" button.** The 60s polling window is generous; if the user is still creating the chat after 60s, they can re-tap "Створити чат" — same effect.
- **No optimistic UI.** Until the backend confirms `chat_invite_url`, we don't show a fake "joining…" state with an inert link. Chat-create is the kind of operation where false-positive UI hurts more than a few seconds of "Чекаю на чат…".
- **No bot-promote affordance.** The bot itself replies in the group asking the user to promote it (per `supabase/functions/bot/index.ts handleGroupAddedForEvent`). The Mini App stays out of that — Telegram is where group admin operations belong.

## Files changed in this commit

- `apps/web/app/(miniapp)/m/event/[id]/EventChatButton.tsx` — new (~115 lines)
- `apps/web/app/(miniapp)/m/event/[id]/EventActions.tsx` — `AttendingBar` accepts and threads `room` + `onRoomChange`; renders `<EventChatButton>` (~12 lines diff)
- `docs/MINI_APP_CHAT_BUTTON.md` — this file
