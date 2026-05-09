// Boots the Telegram WebApp SDK once on mount.
//
// Critical: if Telegram.WebApp.ready() is never called, Telegram leaves its
// own loading placeholder ON TOP of the page. The app renders underneath but
// every tap hits the placeholder, not our buttons — symptom: "I can see the
// onboarding but nothing responds to taps."
//
// Race condition: <Script strategy="beforeInteractive"> is supposed to load
// the SDK before React hydrates, but in Next 16 + Turbopack dev (and in some
// real TMA clients) the script can land slightly after the first useEffect.
// We poll for window.Telegram.WebApp every 50ms for up to ~3 seconds and call
// ready/expand the moment it appears.

"use client";

import { useEffect } from "react";

type WebAppLike = {
  ready: () => void;
  expand: () => void;
  isFullscreen?: boolean;
  requestFullscreen?: () => void;
  disableVerticalSwipes?: () => void;
  enableClosingConfirmation?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
  onEvent?: (event: string, cb: () => void) => void;
};

export function TgInit() {
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const MAX_ATTEMPTS = 60; // 60 × 50ms = 3 seconds

    function init() {
      if (cancelled) return;
      const wa = (window as { Telegram?: { WebApp?: WebAppLike } }).Telegram?.WebApp;
      if (!wa) {
        if (attempts++ < MAX_ATTEMPTS) {
          window.setTimeout(init, 50);
        } else if (process.env.NODE_ENV !== "production") {
          // Outside Telegram (regular browser) — expected; nothing to do.
          console.debug("[TgInit] Telegram.WebApp not available; running in plain browser");
        }
        return;
      }
      try {
        wa.ready();
        wa.expand();
        // Bot API 8.0+: request true fullscreen (no Telegram chrome). Older
        // clients silently lack the method and we fall back to expand() above.
        // Wrap in its own try/catch — some clients throw "FULLSCREEN_FAILED"
        // when fullscreen is unavailable rather than just no-op'ing the call.
        try {
          wa.requestFullscreen?.();
        } catch {
          /* fullscreen unavailable — expand() already gave us full height */
        }
        wa.disableVerticalSwipes?.();
        wa.setHeaderColor?.("#FBF7F0");
        wa.setBackgroundColor?.("#FBF7F0");
      } catch (e) {
        console.warn("[TgInit] init threw:", e);
      }
    }

    init();
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
