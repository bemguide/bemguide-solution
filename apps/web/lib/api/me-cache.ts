// localStorage cache for the current user. Mirrors the feed-cache
// pattern: read on mount, fetch in background, swap on success.
// Keeps /m/me painting instantly when the user taps the profile tab
// instead of staring at a skeleton during the ~900ms /me round-trip.
//
// 24h TTL — long enough to feel free on quick app re-opens, short
// enough that profile edits made elsewhere (admin, web) eventually
// land.

"use client";

import type { V2User } from "./types";

const KEY = "poruch.v2.me.cache.v1";
const TTL_MS = 24 * 60 * 60 * 1000;

type CachedMe = { user: V2User; ts: number };

export function readMeCache(): V2User | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedMe;
    if (typeof parsed?.ts !== "number" || Date.now() - parsed.ts > TTL_MS) return null;
    return parsed.user ?? null;
  } catch {
    return null;
  }
}

export function writeMeCache(user: V2User): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ user, ts: Date.now() }));
  } catch {
    /* ignore */
  }
}

export function clearMeCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
