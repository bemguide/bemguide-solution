// Boots the Telegram WebApp SDK once on mount and tries to take the full
// available area on every host that supports it.
//
// CRITICAL: every Mini App method has a minimum Bot API version. Calling a
// method on an older client logs a warning ("Method X is not supported in
// version Y") to the console. We feature-gate every optional call with
// `isVersionAtLeast()` so older clients (e.g. Telegram Desktop reporting
// 6.0) silently skip what they can't do.
//
// Method → minimum version (per https://core.telegram.org/bots/webapps):
//   ready, expand, close, MainButton, BackButton, onEvent           — 6.0
//   setHeaderColor, setBackgroundColor                              — 6.1
//   showAlert, showConfirm, HapticFeedback                          — 6.2
//   showPopup, scan QR, clipboard                                   — 6.4
//   disableVerticalSwipes, enableVerticalSwipes                     — 7.8
//   requestFullscreen, exitFullscreen, isFullscreen, lockOrientation— 8.0
//
// Why fullscreen reads weirdly:
//   requestFullscreen() reports failure async via the `fullscreenFailed`
//   event (NOT a thrown exception). Some desktop clients also need a user
//   gesture before they accept the request; we install a one-shot
//   pointerdown retry as a fallback.

"use client";

import { useEffect } from "react";

type FullscreenFailedData = { error?: string };

type WebAppLike = {
  ready: () => void;
  expand: () => void;
  isFullscreen?: boolean;
  isExpanded?: boolean;
  requestFullscreen?: () => void;
  exitFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  onEvent?: (event: string, cb: (data?: FullscreenFailedData) => void) => void;
  offEvent?: (event: string, cb: (data?: FullscreenFailedData) => void) => void;
  isVersionAtLeast?: (version: string) => boolean;
  platform?: string;
  version?: string;
};

const SDK_URL = "https://telegram.org/js/telegram-web-app.js";

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

/** True if `wa.version` >= `min` (e.g. "8.0"). Conservative: false if SDK didn't expose isVersionAtLeast. */
function supports(wa: WebAppLike, min: string): boolean {
  return Boolean(wa.isVersionAtLeast && wa.isVersionAtLeast(min));
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

      if (process.env.NODE_ENV !== "production") {
        console.debug(`[TgInit] platform=${wa.platform} version=${wa.version}`);
      }

      // 6.0 baseline — always available.
      try {
        wa.ready();
        wa.expand();
      } catch (e) {
        console.warn("[TgInit] ready/expand threw:", e);
      }

      // 6.1+: theme colors.
      if (supports(wa, "6.1")) {
        try {
          wa.setHeaderColor?.("#FBF7F0");
          wa.setBackgroundColor?.("#FBF7F0");
        } catch (e) {
          console.warn("[TgInit] setHeader/BackgroundColor threw:", e);
        }
      }

      // 7.8+: stop "swipe down to close" from firing while we scroll content.
      if (supports(wa, "7.8")) {
        try {
          wa.disableVerticalSwipes?.();
        } catch (e) {
          console.warn("[TgInit] disableVerticalSwipes threw:", e);
        }
      }

      // 8.0+: true fullscreen. Only attempt if the host supports it; older
      // clients (e.g. the user's TDesktop reporting Bot API 6.0) keep the
      // default panel size — the only way to grow that is to update Telegram.
      if (supports(wa, "8.0")) {
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
          try {
            wa.requestFullscreen?.();
            if (process.env.NODE_ENV !== "production") {
              console.debug(`[TgInit] requestFullscreen called (${source})`);
            }
          } catch (e) {
            console.warn(`[TgInit] requestFullscreen sync error (${source}):`, e);
          }
        };

        tryFs("init");

        // Some desktop clients require a user gesture; retry on first pointerdown.
        pointerListener = () => {
          if (!wa.isFullscreen) tryFs("first-gesture");
        };
        window.addEventListener("pointerdown", pointerListener, {
          once: true,
          capture: true,
        });
      } else if (process.env.NODE_ENV !== "production") {
        console.debug(
          `[TgInit] fullscreen unavailable — host reports Bot API ${wa.version}, requires 8.0+. Update Telegram to expand beyond the default panel.`,
        );
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
