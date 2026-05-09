// Boots the Telegram WebApp SDK once on mount and tries every modern API
// the latest spec offers. We pin the script to a cache-buster query string
// so older cached copies are not served.
//
// What we do, in order, on every host:
//   1. ready()                — Bot API 6.0+
//   2. expand()                — Bot API 6.0+
//   3. requestFullscreen()    — Bot API 8.0+ (no-op + console warning on older hosts)
//   4. lockOrientation()       — Bot API 8.0+
//   5. disableVerticalSwipes() — Bot API 7.8+
//   6. setHeaderColor()        — Bot API 6.1+
//   7. setBackgroundColor()    — Bot API 6.1+
//
// Old hosts (e.g. Telegram Desktop reporting 6.0) emit a one-line
// "Method X is not supported in version Y" warning per call. They are
// console messages from Telegram's SDK, not application errors — the
// app keeps running. Update Telegram to gain real fullscreen + the rest.
//
// Async fullscreen feedback comes via `fullscreenChanged` / `fullscreenFailed`
// events, NOT exceptions. Some desktop clients also need a user gesture, so
// we retry once on the first pointerdown.

"use client";

import { useEffect } from "react";
import { exchangeInitData } from "@/lib/api";

type FullscreenFailedData = { error?: string };

type WebAppLike = {
  ready: () => void;
  expand: () => void;
  isFullscreen?: boolean;
  isExpanded?: boolean;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  lockOrientation?: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  onEvent?: (event: string, cb: (data?: FullscreenFailedData) => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
  platform?: string;
  version?: string;
  initData?: string;
};

// Pin to the latest Telegram-published cache-buster. Bumping the suffix
// forces clients to refetch when Telegram releases a new SDK build.
const SDK_URL = "https://telegram.org/js/telegram-web-app.js?56";

function getWebApp(): WebAppLike | null {
  if (typeof window === "undefined") return null;
  return (window as { Telegram?: { WebApp?: WebAppLike } }).Telegram?.WebApp ?? null;
}

function loadSDK(): Promise<WebAppLike | null> {
  return new Promise((resolve) => {
    if (typeof window === "undefined") return resolve(null);

    const direct = getWebApp();
    if (direct) return resolve(direct);

    let tag = document.querySelector<HTMLScriptElement>('script[src*="telegram-web-app"]');
    if (!tag) {
      tag = document.createElement("script");
      tag.src = SDK_URL;
      tag.async = true;
      document.head.appendChild(tag);
    }

    let settled = false;
    const finish = (wa: WebAppLike | null) => {
      if (settled) return;
      settled = true;
      resolve(wa);
    };

    tag.addEventListener("load", () => finish(getWebApp()));
    tag.addEventListener("error", () => finish(null));

    let attempts = 0;
    const tick = () => {
      const wa = getWebApp();
      if (wa) return finish(wa);
      if (++attempts < 60) {
        window.setTimeout(tick, 50);
      } else {
        finish(null);
      }
    };
    tick();
  });
}

function callQuiet<T>(label: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (e) {
    console.warn(`[TgInit] ${label} threw:`, e);
    return undefined;
  }
}

export function TgInit() {
  useEffect(() => {
    let cancelled = false;
    let pointerListener: ((e: Event) => void) | null = null;

    loadSDK().then((wa) => {
      if (cancelled || !wa) {
        if (!wa && process.env.NODE_ENV !== "production") {
          console.debug("[TgInit] Telegram.WebApp not available; running in plain browser");
        }
        return;
      }

      const supports = (v: string) => Boolean(wa.isVersionAtLeast?.(v));

      if (process.env.NODE_ENV !== "production") {
        console.debug(
          `[TgInit] platform=${wa.platform} botApi=${wa.version} (>=8.0:${supports("8.0")}, >=7.8:${supports("7.8")}, >=6.1:${supports("6.1")})`,
        );
      }

      // 6.0 baseline — every host has these.
      callQuiet("ready", () => wa.ready());
      callQuiet("expand", () => wa.expand());

      // Trade initData for a backend session token. Idempotent — the
      // helper short-circuits when an unexpired token is already in
      // localStorage, and shares a single-flight gate + 5s cool-down
      // with the implicit `ensureAuth` that authed `apiFetch` calls
      // run on their own. So failures here are silent: the next
      // user-driven request will re-attempt and surface the error in
      // its own UI affordance.
      const initData = wa.initData ?? "";
      if (initData) {
        exchangeInitData(initData).catch((err: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[TgInit] exchangeInitData failed (will retry on next call):", err);
          }
        });
      } else if (process.env.NODE_ENV !== "production") {
        console.debug("[TgInit] no initData on the WebApp — skipping auth exchange");
      }

      // Each modern API is gated by the host's reported Bot API version.
      // Without gating, Telegram's SDK calls console.error("Method X is not
      // supported in version Y") on every old client — purely noise that the
      // user can do nothing about short of updating Telegram.
      if (supports("6.1")) {
        callQuiet("setHeaderColor", () => wa.setHeaderColor?.("#FBF7F0"));
        callQuiet("setBackgroundColor", () => wa.setBackgroundColor?.("#FBF7F0"));
      }

      if (supports("7.8")) {
        callQuiet("disableVerticalSwipes", () => wa.disableVerticalSwipes?.());
      }

      // Fullscreen policy: phone clients only.
      //   - On phones (android/ios) Telegram's chrome takes meaningful vertical
      //     space; fullscreen reclaims it for the app.
      //   - On desktop (tdesktop/macos/web*) the Mini App opens in a panel that
      //     fullscreen would inflate to the entire window — usually annoying for
      //     the user, who wants to see the chat alongside.
      const isPhone = wa.platform === "android" || wa.platform === "ios";

      if (isPhone && supports("8.0")) {
        wa.onEvent?.("fullscreenChanged", () => {
          if (process.env.NODE_ENV !== "production") {
            console.debug("[TgInit] fullscreenChanged → isFullscreen=", wa.isFullscreen);
          }
        });
        wa.onEvent?.("fullscreenFailed", (data) => {
          console.warn("[TgInit] fullscreenFailed:", data?.error ?? "unknown");
        });

        const tryFs = (source: string) => {
          if (wa.isFullscreen) return;
          callQuiet(`requestFullscreen(${source})`, () => wa.requestFullscreen?.());
          callQuiet(`lockOrientation(${source})`, () => wa.lockOrientation?.());
        };

        tryFs("init");

        // Some clients require a user gesture before allowing fullscreen.
        pointerListener = () => {
          if (!wa.isFullscreen) tryFs("first-gesture");
        };
        window.addEventListener("pointerdown", pointerListener, {
          once: true,
          capture: true,
        });
      } else if (process.env.NODE_ENV !== "production") {
        if (!isPhone) {
          console.debug(
            `[TgInit] fullscreen skipped on platform=${wa.platform} (desktop = panel mode by design)`,
          );
        } else {
          console.debug(
            `[TgInit] fullscreen unavailable — host reports Bot API ${wa.version}, requires 8.0+. Update Telegram (Desktop ≥5.x, mobile ≥10.x) for real fullscreen.`,
          );
        }
      }
    });

    return () => {
      cancelled = true;
      if (pointerListener) {
        window.removeEventListener("pointerdown", pointerListener, { capture: true });
      }
    };
  }, []);

  return null;
}
