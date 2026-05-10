// Local-storage bookmark store. Used by the "Зберегти в обране"
// action on cards in the «Для тебе» tab (programs first; events and
// places to follow). V0 is browser-only — when the v2 backend grows
// a `/me/bookmarks` endpoint, swap the read/write helpers and seed
// localStorage as a cache.

"use client";

const KEY = "poruch.bookmarks.v1";

export type BookmarkKind = "program" | "event" | "place";

type Store = Record<BookmarkKind, string[]>;

const EMPTY: Store = { program: [], event: [], place: [] };

function load(): Store {
  if (typeof window === "undefined") return { ...EMPTY };
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<Store>;
    return {
      program: Array.isArray(parsed.program) ? parsed.program : [],
      event: Array.isArray(parsed.event) ? parsed.event : [],
      place: Array.isArray(parsed.place) ? parsed.place : [],
    };
  } catch {
    return { ...EMPTY };
  }
}

function save(store: Store): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(store));
  } catch {
    /* quota / private mode — non-fatal */
  }
}

export function isBookmarked(kind: BookmarkKind, id: string): boolean {
  return load()[kind].includes(id);
}

export function listBookmarks(kind: BookmarkKind): string[] {
  return load()[kind].slice();
}

/**
 * Toggle an item in/out of the kind-specific bookmark list. Returns
 * the new state — `true` when the item is now bookmarked, `false`
 * when it was just removed.
 */
export function toggleBookmark(kind: BookmarkKind, id: string): boolean {
  const store = load();
  const list = new Set(store[kind]);
  let nowSaved: boolean;
  if (list.has(id)) {
    list.delete(id);
    nowSaved = false;
  } else {
    list.add(id);
    nowSaved = true;
  }
  store[kind] = [...list];
  save(store);
  return nowSaved;
}
