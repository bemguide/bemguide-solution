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
export function getTgUser(): {
  id?: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  languageCode?: string;
  /** TG profile photo URL. Bot API 7.0+; undefined on older clients or
   *  when the user has no avatar set. */
  photoUrl?: string;
} {
  const u = tg()?.initDataUnsafe?.user;
  return {
    id: u?.id,
    firstName: u?.first_name,
    lastName: u?.last_name,
    username: u?.username,
    languageCode: u?.language_code,
    photoUrl: u?.photo_url,
  };
}

/**
 * Read TG user info, polling for up to `timeoutMs` while
 * `telegram-web-app.js` finishes loading. The non-async `getTgUser()`
 * returns empty fields when called too early (before SDK is on
 * window) — pages that need the data for first paint should use this.
 */
export async function getTgUserWithWait(timeoutMs = 3000): Promise<ReturnType<typeof getTgUser>> {
  if (tg()) return getTgUser();
  if (typeof window === "undefined") return getTgUser();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((r) => window.setTimeout(r, 100));
    if (tg()) return getTgUser();
  }
  return getTgUser();
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

/**
 * Telegram's native QR scanner (Bot API 6.4+). Opens a fullscreen
 * camera popup with `prompt` shown above the viewfinder; resolves
 * with the scanned text on success or `null` if scanning isn't
 * supported / the user cancelled.
 *
 * Two signal paths run in parallel because individual TG clients
 * have shipped each one buggy at different times — we de-dupe in
 * the helper so whichever fires first wins:
 *
 *   1. **`qrTextReceived` event** (preferred). Fires reliably on
 *      iOS/desktop. We also explicitly close the popup, since the
 *      event alone doesn't dismiss it on some clients.
 *   2. **callback passed to `showScanQrPopup`**. Fallback for
 *      clients that don't dispatch the event. Returning `true`
 *      from the callback closes the popup (per TG docs — the
 *      previous version returned `false`, which kept the popup
 *      open and made it look like nothing was happening even
 *      when the scan succeeded).
 *
 * Cancellation (`scanQrPopupClosed`) resolves the promise with
 * null so the caller can clean up state.
 */
export function tgScanQr(prompt?: string): Promise<string | null> {
  return new Promise((resolve) => {
    const wa = tg();
    if (!wa?.showScanQrPopup) {
      resolve(null);
      return;
    }
    if (wa.isVersionAtLeast && !wa.isVersionAtLeast("6.4")) {
      resolve(null);
      return;
    }

    let settled = false;

    function onQrText(payload: unknown) {
      const data = (payload as { data?: string } | undefined)?.data;
      finish(typeof data === "string" ? data : null);
      wa?.closeScanQrPopup?.();
    }

    function onClosed() {
      finish(null);
    }

    function finish(value: string | null) {
      if (settled) return;
      settled = true;
      wa?.offEvent?.("qrTextReceived", onQrText);
      wa?.offEvent?.("scanQrPopupClosed", onClosed);
      resolve(value);
    }

    wa.onEvent?.("qrTextReceived", onQrText);
    wa.onEvent?.("scanQrPopupClosed", onClosed);

    wa.showScanQrPopup({ text: prompt ?? "" }, (data) => {
      // Belt + suspenders: the event listener above usually wins,
      // but on clients that only fire the callback we still want
      // to capture the data. Returning `true` closes the popup.
      finish(typeof data === "string" ? data : null);
      return true;
    });
  });
}
