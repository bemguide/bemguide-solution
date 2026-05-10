// React hook for Telegram's native BackButton (the arrow that
// appears in the WebApp top bar on Bot API 6.1+). Pages that own a
// "back" semantic call this with a handler; the button shows on
// mount, hides on unmount, and the handler runs when the user taps.
//
// Pass `null` to actively hide the button without unmounting the
// caller (e.g. onboarding's greeting screen, where back has no
// destination). The hook still subscribes to a cleanup so a later
// non-null re-render gets a clean slate.
//
// `offClick` only exists on Bot API 6.1+. On older clients we just
// hide the button on cleanup; the stale handler will be replaced on
// the next mount when a fresh `onClick` is registered.

"use client";

import { useEffect } from "react";
import { tg } from "./client";

export function useTelegramBackButton(handler: (() => void) | null): void {
  useEffect(() => {
    const wa = tg();
    if (!wa?.BackButton) return;
    if (handler === null) {
      wa.BackButton.hide();
      return;
    }
    wa.BackButton.onClick(handler);
    wa.BackButton.show();
    return () => {
      wa.BackButton?.hide();
      wa.BackButton?.offClick?.(handler);
    };
  }, [handler]);
}
