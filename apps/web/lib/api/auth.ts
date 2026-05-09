// Auth helper — exchanges Telegram initData for a backend session token.
// Backend is HS256, ~24h TTL, no refresh token. When the JWT expires we
// re-call this with a fresh initData (cheap, the bot token is stable).

"use client";

import { apiFetch, setSession, clearSession, getToken, isSessionExpired } from "./client";
import type { AuthExchangeResponse } from "./types";

const AUTH_PATH = "/auth/telegram";

/**
 * Trade Telegram initData for a session token. Idempotent: if a non-expired
 * token is already in sessionStorage it's reused without hitting the network.
 */
export async function exchangeInitData(initData: string): Promise<AuthExchangeResponse | null> {
  if (!initData) return null;
  if (getToken() && !isSessionExpired()) {
    // Token is still valid; let the caller skip the round-trip if they want.
    // We still return null here so they fall through to whatever cached state.
    return null;
  }
  const res = await apiFetch<AuthExchangeResponse>(AUTH_PATH, {
    method: "POST",
    body: { init_data: initData },
    authed: false,
  });
  setSession(res);
  return res;
}

export function logout(): void {
  clearSession();
}
