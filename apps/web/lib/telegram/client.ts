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

/** Start param from t.me/<bot>?startapp=evt_<id> deep links. */
export function getStartParam(): string {
  return tg()?.initDataUnsafe?.start_param ?? "";
}
