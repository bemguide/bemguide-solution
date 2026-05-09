// Wraps all /m/* routes. The Telegram WebApp SDK is loaded imperatively from
// inside <TgInit /> on mount — both `next/script` strategies were producing a
// "preloaded but not used" warning in TMA + Next 16 + Turbopack dev that left
// `window.Telegram.WebApp` undefined and Telegram's loading placeholder
// permanently on top, blocking every tap.

import type { Metadata } from "next";
import { TgInit } from "./TgInit";

export const metadata: Metadata = {
  title: "Поруч",
  robots: { index: false }, // miniapp routes are not for search
};

export default function MiniappLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <TgInit />
      {/*
        Layout is exactly one TMA viewport tall — fall back to 100dvh outside Telegram.
        overflow-hidden so children control their own scroll surfaces; keeps the iOS
        rubber-band scroll from bouncing the whole shell when only one section needs scroll.
      */}
      {/*
        In fullscreen mode (Bot API 8.0+) Telegram exposes safe-area insets so
        notches / dynamic island / bottom indicator never overlap content.
        We pad the shell with the provided insets; outside Telegram the
        var() falls back to 0 and nothing changes.
      */}
      <div
        className="bg-background mx-auto flex w-full max-w-md flex-col overflow-hidden"
        style={{
          height: "var(--tg-viewport-stable-height, 100dvh)",
          paddingTop: "var(--tg-safe-area-inset-top, 0px)",
          paddingBottom: "var(--tg-safe-area-inset-bottom, 0px)",
          paddingLeft: "var(--tg-safe-area-inset-left, 0px)",
          paddingRight: "var(--tg-safe-area-inset-right, 0px)",
        }}
      >
        {children}
      </div>
    </>
  );
}
