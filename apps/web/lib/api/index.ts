// Public surface of the v2 API client. Import via `@/lib/api`:
//
//   import { getFeed, rsvp, exchangeInitData, type V2Opportunity } from "@/lib/api";
//
// To wire a new deploy:
//   1. Set `NEXT_PUBLIC_API_BASE=https://<backend-host>` in `.env.local`
//      (and the corresponding Vercel env). Without it `apiFetch` throws.
//   2. Mini App auth is bootstrapped by `(miniapp)/TgInit.tsx` —
//      `exchangeInitData(window.Telegram.WebApp.initData)` runs once after
//      the SDK is ready, the token lands in sessionStorage.
//   3. Public SSR routes (e.g. `/event/[id]`) use `./server.ts` instead
//      so they never touch sessionStorage.

export * from "./types";
export * from "./client";
export * from "./auth";
export * from "./feed";
export * from "./feed-cache";
export * from "./users";
export * from "./invitations";
export * from "./opportunities";
export * from "./me";
export * from "./display";
export * from "./messages";
