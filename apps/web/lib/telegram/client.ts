// Client-side helpers for working inside Telegram Mini App.

"use client";

import type { TelegramWebApp } from "./types";

export function tg(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  return window.Telegram?.WebApp ?? null;
}

/** Best-effort initData. Empty string when running outside a Mini App. */
export function getInitData(): string {
  return tg()?.initData ?? "";
}

/** First name from Telegram user info, used as a default display_name. */
export function getTgUser(): { id?: number; firstName?: string; languageCode?: string } {
  const u = tg()?.initDataUnsafe?.user;
  return {
    id: u?.id,
    firstName: u?.first_name,
    languageCode: u?.language_code,
  };
}

/** Start param from t.me/<bot>?startapp=evt_<slug> deep links. */
export function getStartParam(): string {
  return tg()?.initDataUnsafe?.start_param ?? "";
}

/** Wrapper that injects X-Telegram-InitData on every fetch. */
export async function fetchWithInitData<T = unknown>(
  url: string,
  init: RequestInit = {},
): Promise<{ status: number; json: T }> {
  const headers = new Headers(init.headers ?? {});
  headers.set("content-type", "application/json");
  const initData = getInitData();
  if (initData) headers.set("x-telegram-initdata", initData);
  const res = await fetch(url, { ...init, headers });
  let json: T;
  try {
    json = (await res.json()) as T;
  } catch {
    json = null as unknown as T;
  }
  return { status: res.status, json };
}
