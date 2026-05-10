// Footer hotlines list for `GET /feed?filter=programs`. Rendered
// after the program cards. Always present (server returns these
// regardless of city/status).
//
// Tap-to-call: phone numbers in the contract are formatted for human
// reading ("0 800 33 20 29", "5522 → «2»"). The `tel:` URI requires
// the digits-only form, so we strip everything that isn't a digit
// or a leading `+` before constructing the link. Multi-step shortcodes
// like "5522 → «2»" can't be auto-dialled — the trailing instructions
// after the first non-digit run are dropped from the dial action but
// remain visible in the displayed label so the user knows what to do
// after the call connects.
//
// We use the same "programmatic nav + clipboard fallback" pattern as
// SupportBanner because TG Desktop / TG Web have no phone app to
// hand the `tel:` scheme off to — copying the number means the user
// can paste it into whatever they actually use to call.

"use client";

import { useState } from "react";
import { Phone, PhoneCall } from "lucide-react";
import type { HotlineItem } from "@/lib/api";

const TOAST_MS = 2_400;

/**
 * Take a human-formatted phone string and produce the digit-only
 * version Telegram and iOS will accept on a `tel:` link. We keep a
 * leading `+` (for international numbers) and drop everything else
 * non-digit. Multi-step instructions after the first segment (e.g.
 * "5522 → «2»") aren't dial-able, so we slice at the first non-digit
 * past the leading run.
 */
function toDialableTel(phone: string): string {
  const trimmed = phone.trim();
  const lead = trimmed.startsWith("+") ? "+" : "";
  const tail = trimmed.slice(lead.length);
  // Up to the first non-digit-non-space chunk. Drops anything after
  // arrows, parens, IVR steps, etc.
  const m = tail.match(/^[\d\s]+/);
  const digits = (m?.[0] ?? "").replace(/\D/g, "");
  return `tel:${lead}${digits}`;
}

export function HotlinesBlock({ hotlines }: { hotlines: HotlineItem[] }) {
  if (hotlines.length === 0) return null;

  return (
    <section className="space-y-3 pt-2">
      <div className="text-foreground inline-flex items-center gap-2 text-base font-semibold">
        <Phone className="text-primary h-4 w-4" aria-hidden />
        Гарячі лінії
      </div>
      <ul className="bg-card border-border divide-border/60 divide-y rounded-xl border">
        {hotlines.map((h) => (
          <li key={h.id}>
            <HotlineRow hotline={h} />
          </li>
        ))}
      </ul>
    </section>
  );
}

function HotlineRow({ hotline }: { hotline: HotlineItem }) {
  const [toast, setToast] = useState<string | null>(null);
  const tel = toDialableTel(hotline.phone);

  function call() {
    try {
      window.location.href = tel;
    } catch {
      /* some embedded contexts throw on cross-scheme nav — fall through */
    }
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard
        .writeText(hotline.phone)
        .then(() => {
          setToast(`Скопійовано: ${hotline.phone}`);
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
      aria-label={`Зателефонувати: ${hotline.label}, ${hotline.phone}`}
      className="hover:bg-accent/30 flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors"
      style={{ touchAction: "manipulation" }}
    >
      <div className="min-w-0 flex-1">
        <p className="text-foreground truncate text-sm font-semibold leading-snug">
          {hotline.label}
        </p>
        <p className="text-muted-foreground mt-0.5 truncate text-xs">
          {toast ?? hotline.phone}
        </p>
        {hotline.description ? (
          <p className="text-muted-foreground mt-0.5 truncate text-xs">
            {hotline.description}
          </p>
        ) : null}
      </div>
      <PhoneCall className="text-primary h-4 w-4 shrink-0" aria-hidden />
    </button>
  );
}
