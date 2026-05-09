// Auth helpers re-exported from client.ts for convenience. The actual
// token storage + exchange + 401 retry lives in client.ts so it can be
// used internally by `apiFetch` without a circular import.

"use client";

export {
  exchangeInitData,
  logout,
  ensureAuth,
  isTelegramEnvironment,
} from "./client";
