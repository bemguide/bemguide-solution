// localStorage cache for the personalised feed. Lets `/m/feed` paint
// the previous result instantly, then refresh in the background
// (stale-while-revalidate). Keeps return visits feeling free, and
// keeps the empty-state visible during transient backend outages.
//
// Cache is keyed off `poruch.v2.feed.cache.v1` — bump the suffix when
// the on-disk shape changes so old payloads don't deserialize wrong.

"use client";

import type { FeedSections } from "./types";

const KEY = "poruch.v2.feed.cache.v1";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — feed is per-day at most

export type CachedFeed = {
  sections: FeedSections;
  city?: string;
  ts: number;
};

export function readFeedCache(): CachedFeed | null {
  if (typeof window === "undefined") return null;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as CachedFeed;
    if (
      typeof parsed?.ts !== "number" ||
      Date.now() - parsed.ts > TTL_MS ||
      !parsed.sections
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeFeedCache(c: { sections: FeedSections; city?: string }): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ sections: c.sections, city: c.city, ts: Date.now() }),
    );
  } catch {
    /* private mode / quota — ignore */
  }
}

export function clearFeedCache(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
