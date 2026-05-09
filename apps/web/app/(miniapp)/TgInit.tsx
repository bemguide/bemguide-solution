// Boots the Telegram WebApp SDK once on mount.
//
// Why imperative loading instead of <Script strategy="...">:
//   Both `beforeInteractive` and `afterInteractive` produced symptoms in real
//   TMA + Next 16 + Turbopack dev: the browser saw the <link rel=preload> but
//   the matching <script> tag was injected too late (or not at all). Result:
//   window.Telegram.WebApp never landed, ready() was never called, Telegram
//   left its OWN loading placeholder on top of our page, and every tap was
//   eaten by the placeholder.
//
// We now:
//   1. Reuse the SDK if Telegram already injected it (most TMA clients do).
//   2. Otherwise inject our own <script> with onload/onerror + a 3s poll fallback.
//   3. As soon as Telegram.WebApp appears, call ready / expand / requestFullscreen
//      / disableVerticalSwipes / set{Header,Background}Color.

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

    // Reuse an existing tag if one is already in the page (e.g. injected by
    // an earlier mount or by a previous Next.js layout pass).
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

    // Some clients have already-evaluated the script before our listener;
    // poll briefly to catch them. 3s is plenty.
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

export function TgInit() {
  useEffect(() => {
    let cancelled = false;
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
        // Bot API 8.0+: true fullscreen. Older clients silently lack the method
        // or throw FULLSCREEN_FAILED — both are fine, expand() already gave us
        // the maximum vertical area.
        try {
          wa.requestFullscreen?.();
        } catch {
          /* unsupported — keep expand()'s result */
        }
        wa.disableVerticalSwipes?.();
        wa.setHeaderColor?.("#FBF7F0");
        wa.setBackgroundColor?.("#FBF7F0");
      } catch (e) {
        console.warn("[TgInit] init threw:", e);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return null;
}
