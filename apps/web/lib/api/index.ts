// Public surface of the v2 API client. Import via `@/lib/api`:
//
//   import { getFeed, rsvp, exchangeInitData, type V2Opportunity } from "@/lib/api";
//
// Implementation notes (see `docs/V2_FRONTEND.md`):
//
// 1. Set `NEXT_PUBLIC_API_BASE=https://<backend-host>` in apps/web/.env.local.
// 2. Replace the PLACEHOLDER constants in client.ts / auth.ts / feed.ts /
//    users.ts / invitations.ts with the real endpoint paths the backend
//    team publishes.
// 3. The Mini App entry point should call `exchangeInitData(getInitData())`
//    once on mount; subsequent calls reuse the stored session token.

export * from "./types";
export * from "./client";
export * from "./auth";
export * from "./feed";
export * from "./users";
export * from "./invitations";
