// fetch wrapper for the v2 backend API. Handles three jobs that pages
// shouldn't have to worry about:
//
// Dev logging: every request + response is `console.debug`'d in
// non-production. The request side prints method/path/body; the
// response prints status/body. Sensitive fields (init_data, token)
// are redacted.
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

/** True when `window.Telegram.WebApp` has been populated by telegram-web-app.js. */
function isSdkLoaded(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(
    (window as { Telegram?: { WebApp?: unknown } }).Telegram?.WebApp,
  );
}

/**
 * Read initData, waiting up to `timeoutMs` for telegram-web-app.js to
 * finish loading. TgInit kicks off the SDK fetch on mount, but page
 * mounts can race ahead of it — without this wait the first
 * `apiFetch` was throwing `no_telegram_environment` even when running
 * inside Telegram.
 *
 * Polling stops the moment the SDK is loaded — so inside Telegram
 * this resolves within one tick of TgInit completing (~100ms),
 * whereas outside Telegram we time out and the caller can decide
 * what to render.
 */
async function readInitDataWithWait(timeoutMs = 3000): Promise<string> {
  const direct = readInitData();
  if (direct) return direct;
  if (typeof window === "undefined") return "";

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => window.setTimeout(r, 100));
    if (isSdkLoaded()) {
      // SDK has loaded — initData is now authoritative (empty = outside TG).
      return readInitData();
    }
  }
  return "";
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

/**
 * Cool-down window after a failed `/auth/telegram` round-trip. Prevents
 * page-driven onboarding (3 sequential PATCHes) from re-hitting a known-
 * broken backend three times in a row. The first failure is surfaced
 * to the user; everything inside the window throws the cached error
 * without touching the network.
 */
const AUTH_FAILURE_COOLDOWN_MS = 5000;

async function rawAuthExchange(initData: string): Promise<AuthExchangeResponse> {
  if (!API_BASE) {
    throw new ApiError(0, "NEXT_PUBLIC_API_BASE is not set");
  }
  const url = `${API_BASE.replace(/\/$/, "")}${AUTH_PATH}`;
  const startedAt = performance.now();
  devLog("→", "POST", AUTH_PATH, { init_data: redactInitData(initData) });
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
  devLog(
    "←",
    "POST",
    AUTH_PATH,
    `${res.status} ${Math.round(performance.now() - startedAt)}ms`,
    redactAuthResponse(parsed),
  );
  if (!res.ok) {
    const code =
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, parsed);
  }
  return parsed as AuthExchangeResponse;
}

// ---------------------------------------------------------------
// Single-flight auth gate
// ---------------------------------------------------------------

/**
 * Promise of the in-flight auth exchange, if any. Concurrent calls
 * (TgInit + page mount) fan in to a single network round-trip.
 */
let authInFlight: Promise<AuthExchangeResponse | null> | null = null;

/** Last failure timestamp + the original error, for the cooldown gate. */
let lastAuthFailure: { at: number; error: ApiError } | null = null;

/**
 * Single source of truth for `/auth/telegram`. Both `exchangeInitData`
 * (from TgInit) and `ensureAuth` (from `apiFetch` for authed routes)
 * route through this — so we get exactly one round-trip per page load
 * even when the SDK boot races with the first `getCurrentUser`.
 *
 * Throws `ApiError(0, "no_telegram_environment")` when there's no
 * initData on the WebApp (i.e. running outside Telegram).
 */
async function performExchange(): Promise<AuthExchangeResponse | null> {
  if (getToken() && !isSessionExpired()) return null;
  if (authInFlight) return authInFlight;
  if (lastAuthFailure && Date.now() - lastAuthFailure.at < AUTH_FAILURE_COOLDOWN_MS) {
    throw lastAuthFailure.error;
  }
  authInFlight = (async () => {
    try {
      // Wait briefly for telegram-web-app.js to finish loading. Without
      // this the first `apiFetch` after a navigation can race the SDK
      // load and incorrectly conclude "no Telegram environment" while
      // running inside the Mini App.
      const initData = await readInitDataWithWait();
      if (!initData) {
        throw new ApiError(0, "no_telegram_environment");
      }
      const res = await rawAuthExchange(initData);
      setSession(res);
      lastAuthFailure = null;
      return res;
    } catch (e) {
      // Only cache *real* backend failures. `no_telegram_environment`
      // is a transient SDK-not-loaded state (or "outside Telegram") —
      // both are cheap to re-check, so don't burn a 5s cool-down on
      // them.
      if (e instanceof ApiError && e.message !== "no_telegram_environment") {
        lastAuthFailure = { at: Date.now(), error: e };
      }
      throw e;
    }
  })();
  try {
    return await authInFlight;
  } finally {
    authInFlight = null;
  }
}

/**
 * Trade Telegram initData for a session token. Idempotent: if a
 * non-expired token is already in localStorage it short-circuits.
 * Single-flight + 5s cool-down on failure are shared with the
 * implicit `ensureAuth()` path used by `apiFetch`.
 *
 * Returns null when there's no initData on the WebApp — callers can
 * detect this with `isTelegramEnvironment()`.
 *
 * @param initData accepted for compat with the (future) login-widget
 *   fallback path. For now the canonical source is
 *   `window.Telegram.WebApp.initData` and a passed value is ignored.
 */
export async function exchangeInitData(
  initData?: string,
): Promise<AuthExchangeResponse | null> {
  void initData;
  return performExchange();
}

export function logout(): void {
  clearSession();
  lastAuthFailure = null;
}

/**
 * Used by `apiFetch` before every authed request. Same engine as
 * `exchangeInitData` — see `performExchange` for the contract.
 */
export async function ensureAuth(): Promise<void> {
  await performExchange();
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
  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const headers: Record<string, string> = { accept: "application/json" };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.authed !== false) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  devLog("→", method, path, opts.body !== undefined ? opts.body : undefined);
  return fetch(url, {
    method,
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

  const method = opts.method ?? (opts.body !== undefined ? "POST" : "GET");
  const startedAt = performance.now();
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
  devLog("←", method, path, `${res.status} ${Math.round(performance.now() - startedAt)}ms`, parsed);
  if (!res.ok) {
    const code =
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, parsed);
  }
  return parsed as T;
}

// ---------------------------------------------------------------
// Dev logging
// ---------------------------------------------------------------

/**
 * `console.debug` only in non-production. The browser's Network tab
 * already shows full request bodies; this helper exists to put a
 * grep-friendly trail in the JS console so you can tell at a glance
 * which call returned what without leaving the page.
 */
function devLog(...args: unknown[]): void {
  if (process.env.NODE_ENV === "production") return;
  console.debug("[api]", ...args);
}

/** Don't log the raw initData — it's a signed payload tied to a TG account. */
function redactInitData(initData: string): string {
  return `<initData ${initData.length}b>`;
}

/** Don't log the JWT payload either; show prefix + length only. */
function redactAuthResponse(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return body;
  const b = body as { token?: unknown; user?: unknown; expires_at?: unknown };
  if (typeof b.token === "string") {
    return {
      ...body,
      token: `${b.token.slice(0, 14)}…(${b.token.length}b)`,
    };
  }
  return body;
}
