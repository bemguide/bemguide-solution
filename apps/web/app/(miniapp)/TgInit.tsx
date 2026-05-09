// Boots the Telegram WebApp SDK once on mount and keeps the Mini App in
// fullscreen mode whenever the host client supports it (Bot API 8.0+).
//
// Why imperative SDK loading instead of <Script strategy="...">:
//   In Next 16 + Turbopack dev, both beforeInteractive and afterInteractive
//   left the script as a "preloaded but never used" link, so window.Telegram
//   .WebApp never landed → ready() was never called → Telegram kept its
//   loading placeholder on top of our app → every tap was eaten by it.
//
// Why fullscreen needs special handling:
//   requestFullscreen() reports failure asynchronously via a `fullscreenFailed`
//   event, NOT by throwing. A try/catch around the call won't catch it. Some
//   desktop clients also require a user gesture before allowing fullscreen, so
//   we install a one-shot listener on first pointerdown that retries.

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

function tryFullscreen(wa: WebAppLike, source: string) {
  if (wa.isFullscreen) return;
  try {
    wa.requestFullscreen?.();
    if (process.env.NODE_ENV !== "production") {
      console.debug(
        `[TgInit] requestFullscreen() called (${source}); platform=${wa.platform} version=${wa.version}`,
      );
    }
  } catch (e) {
    console.warn(`[TgInit] requestFullscreen sync error (${source}):`, e);
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

      try {
        wa.ready();
        wa.expand();
        wa.disableVerticalSwipes?.();
        wa.setHeaderColor?.("#FBF7F0");
        wa.setBackgroundColor?.("#FBF7F0");
      } catch (e) {
        console.warn("[TgInit] init threw:", e);
      }

      // Async fullscreen feedback — Telegram reports failure via events.
      wa.onEvent?.("fullscreenChanged", () => {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[TgInit] fullscreenChanged → isFullscreen=", wa.isFullscreen);
        }
      });
      wa.onEvent?.("fullscreenFailed", (data) => {
        console.warn("[TgInit] fullscreenFailed:", data?.error ?? "unknown");
      });

      // First attempt right after init.
      tryFullscreen(wa, "init");

      // Some desktop clients reject fullscreen requests that aren't tied to a
      // user gesture. Retry once on the first pointerdown so the next tap
      // promotes the Mini App to true fullscreen automatically.
      pointerListener = () => {
        if (!wa.isFullscreen) tryFullscreen(wa, "first-gesture");
      };
      window.addEventListener("pointerdown", pointerListener, { once: true, capture: true });
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
