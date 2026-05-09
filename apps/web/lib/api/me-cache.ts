// localStorage cache for the profile tab. Holds the V2User row, the
// last `/me/upcoming` payload, and the Telegram avatar URL — all the
// pieces /m/me needs to paint a fully-populated profile on a tab
// switch instead of starting at "skeleton + 'Завантажуємо…' + letter
// fallback" every time.
//
// Mirrors the feed-cache pattern (24h TTL, SSR-safe read). Bump the
// `.v2` suffix when the on-disk shape changes.

"use client";

import type { UpcomingItem } from "./me";
import type { V2User } from "./types";

const KEY = "poruch.v2.me.cache.v2";
const TTL_MS = 24 * 60 * 60 * 1000;

export type CachedMe = {
  user: V2User;
  /** Last /me/upcoming items. `null` = haven't fetched yet. */
  upcoming: UpcomingItem[] | null;
  /** Telegram avatar URL (initDataUnsafe.user.photo_url). */
  photo_url: string | null;
  ts: number;
};

export function readMeCache(): CachedMe | null {
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
    if (!parsed.user) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeMeCache(slice: {
  user: V2User;
  upcoming?: UpcomingItem[] | null;
  photoUrl?: string | null;
}): void {
  if (typeof window === "undefined") return;
  const existing = readMeCache();
  const merged: CachedMe = {
    user: slice.user,
    upcoming: slice.upcoming ?? existing?.upcoming ?? null,
    photo_url: slice.photoUrl ?? existing?.photo_url ?? null,
    ts: Date.now(),
  };
  try {
    window.localStorage.setItem(KEY, JSON.stringify(merged));
  } catch {
    /* ignore */
  }
}

export function clearMeCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
    // Also drop the v1 key in case it lingered from before this rev.
    window.localStorage.removeItem("poruch.v2.me.cache.v1");
  } catch {
    /* ignore */
  }
}
