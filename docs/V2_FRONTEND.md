# v2 frontend wiring

> Status: **wired** against `auth-backend` (the v2 REST contract). The
> miniapp + public event page now fetch from `NEXT_PUBLIC_API_BASE`.
> Admin panel still uses the v1 Supabase reads inside `apps/web/lib/supabase/server.ts`
> — out of scope for this migration.

## What's in the box

```
apps/web/lib/api/
├── client.ts         fetch wrapper, ApiError, sessionStorage tokens
├── server.ts         Node-side fetch for SSR (no sessionStorage)
├── types.ts          v2 entity types + enums + composites
├── auth.ts           exchangeInitData() / logout()
├── users.ts          getCurrentUser() / updateCurrentUser(patch)
├── feed.ts           getFeed({ city }) / getOpportunity(id) / getOpportunityAttendees(id)
├── opportunities.ts  createOpportunity(body) / listOpportunities(opts)
├── invitations.ts    rsvp() / setShowNamePublicly() / getRoom()
├── me.ts             getMyMatches / getMatches / getMyInvitations / patchInvitation /
│                     updateAttendance / getUpcoming
├── display.ts        opportunityToDisplay() — adapter to EventForDisplay
└── index.ts          barrel export
```

Import everywhere from `@/lib/api`:

```ts
import {
  ApiError,
  exchangeInitData,
  getFeed,
  getOpportunity,
  rsvp,
  type OpportunityCard,
} from "@/lib/api";
```

For server-side fetches (the public event page):

```ts
import { serverGet } from "@/lib/api/server";
const event = await serverGet<OpportunityCard>(`/opportunities/${id}`, { revalidate: 60 });
```

## Configuration

Set on every host (local dev, ngrok, Vercel preview, Vercel prod):

```
NEXT_PUBLIC_API_BASE=https://<auth-backend-host>
```

When unset, every `apiFetch` call throws `ApiError("NEXT_PUBLIC_API_BASE is not set")`
and the UI surfaces a friendly fallback. Public SSR routes throw at build/render time.

## Auth bootstrap

`(miniapp)/TgInit.tsx` runs once on mount (after the Telegram WebApp SDK is
ready) and calls:

```ts
const initData = window.Telegram?.WebApp?.initData ?? "";
if (initData) await exchangeInitData(initData);
```

`exchangeInitData` is idempotent — if a non-expired token is already in
`sessionStorage` it short-circuits without hitting the network. Pages that
might run before the bootstrap completes (e.g. fast navigations from the
bot) call it themselves before their first `apiFetch` — see
`FeedClient.tsx`, `ClientEventPage.tsx`, `OnboardingFlow.tsx`,
`ProposeFlow.tsx`.

## Token lifetime

Tokens live in `sessionStorage` (`poruch.v2.token`) and survive navigation
inside the same Mini App tab, but die when Telegram dismisses the
webview. Backend default TTL is 24h with no refresh — when the token
expires we re-call `/auth/telegram` with a fresh initData.

## Page → endpoint map

| Surface              | Calls                                                                                              |
| -------------------- | -------------------------------------------------------------------------------------------------- |
| `/m/feed`            | `getCurrentUser()` (for city), `getFeed({ city })`                                                 |
| `/m/event/[id]`      | `getOpportunity(id)`, `getOpportunityAttendees(id)`, `rsvp(id, …)`, `getRoom(id)`, `setShowNamePublicly(id, bool)` |
| `/m/onboarding`      | `updateCurrentUser({ city / interests / company_preference / accessibility_flags / bio })` per step |
| `/m/propose`         | `getCurrentUser()` (city pre-fill), `createOpportunity(body)`                                       |
| `/event/[id]` (SSR)  | `serverGet('/opportunities/:id')`, `serverGet('/opportunities/:id/attendees')`                      |

## Type drift to keep in mind

- v2 has no `slug` column. URLs use the opportunity UUID, and the
  display-shape adapter (`opportunityToDisplay`) sets `slug = id`.
- `EventForDisplay.honest_absences` is always `null` from v2 (the concept
  doesn't exist in the new schema). The accessibility strip just hides
  that section.
- `OpportunityCard.distance_km` is always `null` on the wire — frontend
  computes it from geolocation if needed (the existing components handle
  null gracefully).

## Adding a new endpoint

1. Pick the file by feature: feed/users/opportunities/invitations/me.
2. Add a typed wrapper that calls `apiFetch<T>(path, opts)`.
3. Export from the file (the barrel re-exports the whole module).
4. Update this doc's page → endpoint map if a page consumes it.

## Demo behaviour

Until the backend is reachable, every authed call surfaces an
`ApiError` and the page renders its empty/error state instead of
loading. Public SSR pages 500 with the same code, which Next.js catches
into `not-found` only when the backend explicitly returns 404. To run
fully offline, point `NEXT_PUBLIC_API_BASE` at a stub or run the
backend locally on `:8080`.
