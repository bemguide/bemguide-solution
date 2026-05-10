// Always-visible psychological-support hotline strip mounted in
// `(miniapp)/layout.tsx` so it sits above every screen in the flow —
// onboarding, feed, propose, event detail, profile, assistant.
//
// Why always-visible: the audience overlaps heavily with the ~33% of
// veterans showing symptoms of depression, and someone in that state
// may not seek help unless it's quietly there. Passive visibility +
// one-tap call beats a "Help" tab the user has to find.
//
// Number: `0 800 332 800` — Лінія психологічної допомоги ветеранам
// (free, 24/7). International form for the `tel:` link so it works
// from outside Ukraine; the visible label keeps the local readable
// formatting users will recognise.
//
// Why a button + onClick instead of plain `<a href="tel:">`:
// Telegram's iOS WKWebView quietly blocks anchor clicks on non-HTTP
// schemes in some configurations — the tap registers but no dialer
// opens. Programmatic `window.location.href` assignment goes through
// the same scheme-decision path with a "real" user-gesture context
// and is more reliable. A clipboard-copy fallback covers TG Desktop
// / TG Web where `tel:` is meaningless (no phone app to dial).
//
// Touch target: 40px tall — above the 36px Material minimum, just
// under the 44px iOS HIG ideal. Going larger would eat too much of
// the TMA viewport on small screens; users still have the assistant
// tab and the agent's crisis-handoff card as fuller-screen paths.

"use client";

import { useState } from "react";
import { HeartPulse, PhoneCall } from "lucide-react";
import { cn } from "@/lib/utils";

const HOTLINE_LABEL = "0 800 332 800";
const HOTLINE_TEL = "tel:+380800332800";
const TOAST_MS = 2_400;

export function SupportBanner() {
  const [toast, setToast] = useState<string | null>(null);

  function call() {
    // 1. Programmatic navigation — most reliable way to trigger the
    //    native dialer through iOS WKWebView's scheme handler.
    try {
      window.location.href = HOTLINE_TEL;
    } catch {
      /* some embedded contexts throw on cross-scheme nav — fall through */
    }

    // 2. Best-effort clipboard copy. On TG Desktop / TG Web there's
    //    no phone app to dial; copying the number means the user can
    //    paste it into whatever they actually use to make the call.
    //    The `?.` lets older browsers sail past with no toast.
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(HOTLINE_LABEL)
        .then(() => {
          setToast(`Номер скопійовано: ${HOTLINE_LABEL}`);
          window.setTimeout(() => setToast(null), TOAST_MS);
        })
        .catch(() => {
          /* permission / focus issue — silent */
        });
    }
  }

  return (
    <button
      type="button"
      onClick={call}
      aria-label="Зателефонувати на лінію психологічної допомоги ветеранам — 0 800 332 800, безкоштовно, цілодобово"
      className={cn(
        "bg-accent text-accent-foreground border-border/60 hover:bg-accent/80",
        "relative inline-flex h-10 w-full shrink-0 cursor-pointer items-center justify-center gap-2 border-b px-3",
        "text-xs font-medium transition-colors",
      )}
      style={{ touchAction: "manipulation" }}
    >
      <HeartPulse className="text-primary h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        {toast ? (
          toast
        ) : (
          <>
            Лінія підтримки{" "}
            <span className="font-semibold">{HOTLINE_LABEL}</span>
            <span className="opacity-70"> · 24/7, безкоштовно</span>
          </>
        )}
      </span>
      <PhoneCall className="text-primary h-3.5 w-3.5 shrink-0" aria-hidden />
    </button>
  );
}
