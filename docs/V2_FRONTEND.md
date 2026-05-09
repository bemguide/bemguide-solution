# v2 frontend wiring

> Status: **scaffold only**. Existing M1–M15 surfaces still use the v1 lane (`veterans` / `events` / `rsvps`) via Next.js `/api/*` routes. The v2 client lives in `apps/web/lib/api/` waiting for the backend team's contract.

## What's in the box

```
apps/web/lib/api/
├── client.ts       fetch wrapper, session-storage tokens, ApiError
├── types.ts        v2 entity types (User, Opportunity, EventMatch, EventInvitation,
│                   EventAttendee, EventRoom) + enums + composites (OpportunityCard, FeedSections)
├── auth.ts         exchangeInitData() / logout()
├── users.ts        getCurrentUser() / updateCurrentUser(patch)
├── feed.ts         getFeed({ city }) / getOpportunity(id) / getOpportunityAttendees(id)
├── invitations.ts  rsvp(eventId, { response, … }) / setShowNamePublicly() / getRoom()
└── index.ts        barrel
```

Import everywhere from `@/lib/api`:

```ts
import { getFeed, rsvp, exchangeInitData, type OpportunityCard } from "@/lib/api";
```

## Wire-up checklist

When the backend team publishes the contract:

1. **Base URL.** Add `NEXT_PUBLIC_API_BASE=https://<backend-host>` to `apps/web/.env.local` (and to Vercel env). Without it, `apiFetch` throws on every call.
2. **Endpoint paths.** Search the codebase for `// PLACEHOLDER` and replace each constant with the real path. Current placeholders:
   - `/auth/telegram` (`auth.ts`) — POST `{ init_data }` → `{ token, expires_at, user }`
   - `/me` (`users.ts`) — GET → `V2User`; PATCH `{ partial }` → `V2User`
   - `/feed?city=…` (`feed.ts`) — GET → `FeedSections`
   - `/opportunities/:id` — GET → `OpportunityCard`
   - `/opportunities/:id/attendees` — GET → `{ count, names_visible[] }`
   - `/opportunities/:id/rsvp` — POST `{ response, … }` → `{ invitation, attendee, room }`
   - `/opportunities/:id/room` — GET → `V2EventRoom | null`
   - `/opportunities/:id/attendee/show-name` — PATCH `{ show }` → `{ status, show_name_publicly }`
3. **Auth bootstrap.** In the (miniapp) layout's `TgInit` (or a sibling client component), after the SDK is ready call once:
   ```ts
   const initData = window.Telegram?.WebApp?.initData ?? "";
   if (initData) await exchangeInitData(initData);
   ```
   Subsequent calls reuse the cached token until `expires_at`.
4. **Adapter at the page layer.** Each existing page is wired to v1. Migrate page-by-page:
   - `/m/feed` → swap the `/api/feed` fetch for `getFeed({ city })`. Replace `EventForDisplay` with `OpportunityCard` (drop `slug`/`honest_absences`/`going_count` → `id`/`-`/`attendee_count`).
   - `/m/event/[id]` (rename from `[slug]`) → `getOpportunity(id) + getOpportunityAttendees(id)` instead of `getEventBySlug` + `getPublicRsvpCount`.
   - `/m/event/[id]` RSVP modal → `rsvp(id, { response: 'accepted', display_name, show_name_publicly })` instead of `/api/rsvp/create`.
   - `/m/onboarding` → on each step, call `updateCurrentUser({ city, interests, … })` instead of `/api/veteran/upsert`.
   - Public `/event/[id]` is server-rendered today; making it talk to the backend means either an SSR fetch (set `revalidate: 60`) or making the page client-rendered. Recommended: SSR fetch with no Auth header (read-only public path).
5. **Drop v1 routes you no longer call.** When a page is fully on v2, delete the matching Next.js route in `apps/web/app/api/`. Don't preemptively delete — keep them around until each page is migrated and verified.

## Token lifetime

`client.ts` stores the token in `sessionStorage`, so it survives navigation but dies when Telegram dismisses the Mini App. That keeps anonymous-mode shareable URLs (`/event/[id]`) safe by default and forces a fresh `exchangeInitData` on every Mini App open.

If we want longer-lived sessions later (e.g. push-notification triggered re-opens that need to skip the exchange), switch to `localStorage` and add a refresh-token endpoint to the contract.

## Demo behaviour today

Until the contract is wired, every `apiFetch` call throws `ApiError("NEXT_PUBLIC_API_BASE is not set — …")`. The existing v1 stack continues to power the demo: bot, public event page, miniapp surfaces, admin panel. Nothing in this repo imports from `@/lib/api` yet, so the scaffold has zero runtime impact.
