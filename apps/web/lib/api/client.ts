// fetch wrapper for the v2 backend API. Reads the base URL from
// NEXT_PUBLIC_API_BASE; everything else is a path off that root. Tokens
// live in sessionStorage, so they're scoped to the Mini App's tab and
// die when Telegram closes the webview.
//
// All paths below are PLACEHOLDERS — swap to the real endpoints when the
// backend team publishes their contract. Search for "PLACEHOLDER" to find
// the spots that need updating.

"use client";

import type { AuthExchangeResponse } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";
const TOKEN_KEY = "poruch.v2.token";
const EXPIRY_KEY = "poruch.v2.token_expires_at";

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
  return window.sessionStorage.getItem(TOKEN_KEY);
}

export function setSession(res: AuthExchangeResponse): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(TOKEN_KEY, res.token);
  window.sessionStorage.setItem(EXPIRY_KEY, res.expires_at);
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(EXPIRY_KEY);
}

export function isSessionExpired(now: Date = new Date()): boolean {
  if (typeof window === "undefined") return true;
  const exp = window.sessionStorage.getItem(EXPIRY_KEY);
  if (!exp) return true;
  const t = Date.parse(exp);
  if (Number.isNaN(t)) return true;
  return t <= now.getTime();
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
};

export async function apiFetch<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(
      0,
      "NEXT_PUBLIC_API_BASE is not set — the v2 backend URL must be configured before any apiFetch call.",
    );
  }
  const url = `${API_BASE.replace(/\/$/, "")}${path}`;
  const headers: Record<string, string> = {
    accept: "application/json",
  };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.authed !== false) {
    const token = getToken();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    signal: opts.signal,
  });
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const message =
      (typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null) ?? `HTTP ${res.status}`;
    throw new ApiError(res.status, message, parsed);
  }
  return parsed as T;
}
