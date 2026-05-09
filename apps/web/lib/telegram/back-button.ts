// React hook for Telegram's native BackButton (the arrow that
// appears in the WebApp top bar on Bot API 6.1+). Pages that own a
// "back" semantic — currently just /m/event/[id] — call this with a
// handler; the button shows on mount, hides on unmount, and the
// handler runs when the user taps it.
//
// `offClick` only exists on Bot API 6.1+. On older clients we just
// hide the button on cleanup; the stale handler will be replaced on
// the next mount when a fresh `onClick` is registered.

"use client";

import { useEffect } from "react";
import { tg } from "./client";

export function useTelegramBackButton(handler: () => void): void {
  useEffect(() => {
    const wa = tg();
    if (!wa?.BackButton) return;
    wa.BackButton.onClick(handler);
    wa.BackButton.show();
    return () => {
      wa.BackButton?.hide();
      wa.BackButton?.offClick?.(handler);
    };
  }, [handler]);
}
