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

/**
 * Request the user's location using Telegram's LocationManager API.
 * Returns null when:
 *   - LocationManager isn't available (older Telegram client; <8.0)
 *   - the platform reports `isLocationAvailable === false`
 *   - the user denied access (the caller should then call openSettings)
 *
 * The "denied" path doesn't surface a distinct error code from
 * Telegram's SDK — the callback fires with `null`. Callers that need
 * to distinguish "denied" from "unavailable" can read
 * `tg().LocationManager.isAccessGranted` after the call returns.
 */
export async function tgGetLocation(): Promise<{ lat: number; lng: number } | null> {
  const wa = tg();
  if (!wa) return null;
  const lm = wa.LocationManager;
  if (!lm) return null;
  if (wa.isVersionAtLeast && !wa.isVersionAtLeast("8.0")) return null;

  if (!lm.isInited) {
    await new Promise<void>((resolve) => lm.init(() => resolve()));
  }
  if (!lm.isLocationAvailable) return null;

  return new Promise((resolve) => {
    lm.getLocation((data) => {
      if (!data) return resolve(null);
      resolve({ lat: data.latitude, lng: data.longitude });
    });
  });
}

/** True when LocationManager is available AND access has been denied. */
export function tgLocationDenied(): boolean {
  const wa = tg();
  const lm = wa?.LocationManager;
  if (!lm || !lm.isInited) return false;
  return lm.isAccessRequested && !lm.isAccessGranted;
}

/** Open Telegram's per-Mini-App location settings (8.0+). */
export function tgOpenLocationSettings(): void {
  tg()?.LocationManager?.openSettings();
}
