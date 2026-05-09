// fetch wrapper for the v2 backend API. Handles three jobs that pages
// shouldn't have to worry about:
//
//   1. **Token persistence.** localStorage, keyed by `poruch.v2.token` +
//      `poruch.v2.token_expires_at`. Backend default TTL is 24h, no
//      refresh — when the token nears expiry we re-exchange initData.
//      Using localStorage (not sessionStorage) so the session survives
//      hard refreshes and Telegram WebApp re-mounts.
//
//   2. **Auto auth.** Authed `apiFetch` calls await `ensureAuth()` which,
//      if the token is missing/expired, calls `POST /auth/telegram` with
//      `window.Telegram.WebApp.initData` and stores the result. A
//      single-flight promise dedupes concurrent first-loads (TgInit +
//      page mount race).
//
//   3. **401 self-healing.** If a request comes back 401 we clear the
//      session and re-exchange initData once before retrying. Covers the
//      "token rotated server-side" / "drifted clock" cases without the
//      user seeing an error.
//
// Error envelope: `{ ok: false, error, message, details }`. We surface
// `error` as the ApiError.message (machine-readable code) and stash the
// whole body on `.body`.

"use client";

import type { AuthExchangeResponse } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const TOKEN_KEY = "poruch.v2.token";
const EXPIRY_KEY = "poruch.v2.token_expires_at";

/**
 * Re-exchange when fewer than this many seconds remain on the token —
 * lets background tabs refresh without waiting for the next 401.
 */
const TOKEN_NEAR_EXPIRY_SECONDS = 60;

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---------------------------------------------------------------
// Token storage
// ---------------------------------------------------------------

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setSession(res: AuthExchangeResponse): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TOKEN_KEY, res.token);
    window.localStorage.setItem(EXPIRY_KEY, res.expires_at);
  } catch {
    /* private mode / quota */
  }
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(TOKEN_KEY);
    window.localStorage.removeItem(EXPIRY_KEY);
  } catch {
    /* ignore */
  }
}

export function isSessionExpired(now: Date = new Date()): boolean {
  if (typeof window === "undefined") return true;
  let exp: string | null;
  try {
    exp = window.localStorage.getItem(EXPIRY_KEY);
  } catch {
    return true;
  }
  if (!exp) return true;
  const t = Date.parse(exp);
  if (Number.isNaN(t)) return true;
  return t - TOKEN_NEAR_EXPIRY_SECONDS * 1000 <= now.getTime();
}

// ---------------------------------------------------------------
// Telegram environment detection
// ---------------------------------------------------------------

/** Pull initData from the Telegram WebApp SDK if present. */
function readInitData(): string {
  if (typeof window === "undefined") return "";
  const wa = (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp;
  return wa?.initData ?? "";
}

/** True when this page is running inside a Telegram Mini App. */
export function isTelegramEnvironment(): boolean {
  return readInitData().length > 0;
}

// ---------------------------------------------------------------
// Auth exchange — owned by client.ts to keep the dependency graph
// flat (auth.ts is a thin re-export).
// ---------------------------------------------------------------

const AUTH_PATH = "/auth/telegram";

async function rawAuthExchange(initData: string): Promise<AuthExchangeResponse> {
  if (!API_BASE) {
    throw new ApiError(0, "NEXT_PUBLIC_API_BASE is not set");
  }
  const url = `${API_BASE.replace(/\/$/, "")}${AUTH_PATH}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ init_data: initData }),
  });
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const code =
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, parsed);
  }
  return parsed as AuthExchangeResponse;
}

/**
 * Trade Telegram initData for a session token. Idempotent: if a
 * non-expired token is already in localStorage it short-circuits.
 *
 * Returns null when there is no initData on the WebApp (i.e. running
 * in a plain browser) — callers can detect this with
 * `isTelegramEnvironment()` before deciding what UI to render.
 */
export async function exchangeInitData(
  initDataOverride?: string,
): Promise<AuthExchangeResponse | null> {
  const initData = initDataOverride ?? readInitData();
  if (!initData) return null;
  if (getToken() && !isSessionExpired()) return null;
  const res = await rawAuthExchange(initData);
  setSession(res);
  return res;
}

export function logout(): void {
  clearSession();
}

// ---------------------------------------------------------------
// Single-flight auth gate
// ---------------------------------------------------------------

/**
 * Promise of the in-flight auth exchange, if any. Concurrent
 * `ensureAuth` calls fan in to a single network round-trip.
 */
let authInFlight: Promise<void> | null = null;

/**
 * Ensure a usable token is in localStorage before the next request.
 * Throws `ApiError(0, "no_telegram_environment")` if there's no
 * initData (i.e. running outside a Telegram WebApp). Pages call this
 * indirectly via authed `apiFetch`.
 */
export async function ensureAuth(): Promise<void> {
  if (getToken() && !isSessionExpired()) return;
  if (authInFlight) {
    await authInFlight;
    return;
  }
  authInFlight = (async () => {
    const initData = readInitData();
    if (!initData) {
      throw new ApiError(0, "no_telegram_environment");
    }
    const res = await rawAuthExchange(initData);
    setSession(res);
  })();
  try {
    await authInFlight;
  } finally {
    authInFlight = null;
  }
}

// ---------------------------------------------------------------
// Core fetch
// ---------------------------------------------------------------

type RequestOpts = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
  /** Default true — drops Authorization for endpoints that don't need it. */
  authed?: boolean;
  /** Internal — set to true on the second pass after a 401 retry. */
  _retried?: boolean;
};

async function doFetch(path: string, opts: RequestOpts): Promise<Response> {
  const url = `${API_BASE.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.authed !== false) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  return fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
}

export async function apiFetch<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, "NEXT_PUBLIC_API_BASE is not set");
  }

  // Make sure we have a token before any authed request. Anonymous
  // endpoints (public opportunity reads) skip this with `authed: false`.
  if (opts.authed !== false) {
    await ensureAuth();
  }

  let res = await doFetch(path, opts);

  // Self-heal one 401 — Telegram may have rotated initData, our clock
  // may have drifted, or the backend redeployed and lost the token.
  // Clearing + re-exchanging is cheap (the bot token is stable).
  if (res.status === 401 && opts.authed !== false && !opts._retried) {
    clearSession();
    try {
      await ensureAuth();
      res = await doFetch(path, { ...opts, _retried: true });
    } catch {
      // Fall through; surface the original 401 below.
    }
  }

  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const code =
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, parsed);
  }
  return parsed as T;
}
