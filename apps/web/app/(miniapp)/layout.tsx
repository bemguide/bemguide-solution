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
      <Script src="https://telegram.org/js/telegram-web-app.js" strategy="beforeInteractive" />
      <TgInit />
      {/*
        Layout is exactly one TMA viewport tall — fall back to 100dvh outside Telegram.
        overflow-hidden so children control their own scroll surfaces; keeps the iOS
        rubber-band scroll from bouncing the whole shell when only one section needs scroll.
      */}
      <div
        className="bg-background mx-auto flex w-full max-w-md flex-col overflow-hidden"
        style={{
          height: "var(--tg-viewport-stable-height, 100dvh)",
        }}
      >
        {children}
      </div>
    </>
  );
}
