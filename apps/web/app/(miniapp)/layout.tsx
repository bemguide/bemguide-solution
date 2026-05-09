// Wraps all /m/* routes. Loads the Telegram WebApp SDK and calls expand() on mount.

import Script from "next/script";
import type { Metadata } from "next";
import { TgInit } from "./TgInit";

export const metadata: Metadata = {
  title: "Поруч",
  robots: { index: false }, // miniapp routes are not for search
};

export default function MiniappLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/*
        afterInteractive is more reliable in Next 16 + Turbopack than
        beforeInteractive for third-party SDKs. TgInit polls for the SDK
        until it lands, so the timing relative to hydration doesn't matter.
      */}
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="afterInteractive" />
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
