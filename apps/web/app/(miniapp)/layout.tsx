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
      <div className="bg-background mx-auto flex min-h-screen w-full max-w-md flex-col">
        {children}
      </div>
    </>
  );
}
