// Calls Telegram.WebApp.ready/expand once on mount. Imported by the (miniapp) layout.

"use client";

import { useEffect } from "react";
import { tg } from "@/lib/telegram/client";

export function TgInit() {
  useEffect(() => {
    const wa = tg();
    wa?.ready();
    wa?.expand();
  }, []);
  return null;
}
