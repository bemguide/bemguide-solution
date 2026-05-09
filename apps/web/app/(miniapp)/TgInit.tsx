// Boots the Telegram WebApp SDK once on mount.
//   - ready() must be called before any other API.
//   - expand() makes the app take the full vertical height (otherwise it opens at ~half height).
//   - disableVerticalSwipes (Bot API 7.7+) prevents accidental "swipe down to close" while the
//     user is scrolling our own content; missing methods are no-ops.

"use client";

import { useEffect } from "react";
import { tg } from "@/lib/telegram/client";

type WebAppExtras = {
  disableVerticalSwipes?: () => void;
  setHeaderColor?: (c: string) => void;
  setBackgroundColor?: (c: string) => void;
};

export function TgInit() {
  useEffect(() => {
    const wa = tg();
    if (!wa) return;
    try {
      wa.ready();
      wa.expand();
      const extras = wa as unknown as WebAppExtras;
      extras.disableVerticalSwipes?.();
      // Match our warm cream palette so the Telegram chrome doesn't flash white.
      extras.setHeaderColor?.("#FBF7F0");
      extras.setBackgroundColor?.("#FBF7F0");
    } catch {
      /* ignore — older clients lack some methods */
    }
  }, []);
  return null;
}
