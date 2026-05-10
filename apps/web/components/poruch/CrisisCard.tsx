// Crisis-handoff renderer for the agent's `action: crisis_handoff` event.
// Spec §8 has hard requirements that override normal chat-bubble UX:
//
//   - Full-bleed card, NOT a chat bubble.
//   - Hotlines render as tap-to-call buttons.
//   - Numbers come in like "0 800 33 20 29" — strip whitespace before
//     wrapping in `tel:`.
//   - No autoplay sound, no haptic vibrate, no flash.
//   - Render text VERBATIM. Don't summarise, don't paraphrase, don't
//     "soften" via a second LLM call. The strings are pre-cleared by
//     a clinician.
//
// Component is a presentational unit — the parent owns the gating
// (chat input disabled, spinner hidden, etc.). The "Зрозуміло"
// dismiss action is also the parent's responsibility because it has
// to know when to allow the next user_message.

"use client";

import { Button } from "@/components/ui/button";
import type { CrisisCardData } from "@/lib/agent";

function telHref(phone: string): string {
  // Spec example: `"0 800 33 20 29"` → `tel:0800332029`
  return `tel:${phone.replace(/\s+/g, "")}`;
}

export function CrisisCard({
  card,
  onDismiss,
}: {
  card: CrisisCardData;
  /** Re-enables the chat composer below. */
  onDismiss: () => void;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="bg-card border-border space-y-4 rounded-2xl border-2 p-5 shadow-lg"
    >
      <div className="space-y-2">
        <h2 className="text-foreground text-lg font-semibold leading-snug">
          {card.title}
        </h2>
        <p className="text-foreground whitespace-pre-line text-base leading-relaxed">
          {card.body_uk}
        </p>
      </div>

      <ul className="space-y-2">
        {card.hotlines.map((h) => (
          <li key={`${h.label}-${h.phone}`}>
            <Button
              asChild
              size="lg"
              className="h-auto w-full flex-col items-start gap-1 whitespace-normal py-3 text-left"
            >
              <a
                href={telHref(h.phone)}
                aria-label={`${h.label} — ${h.phone}`}
              >
                <span className="text-base font-semibold leading-tight">
                  {h.label}
                </span>
                <span className="text-primary-foreground/85 text-sm leading-tight">
                  {h.phone}
                </span>
                {h.note ? (
                  <span className="text-primary-foreground/70 text-xs leading-tight">
                    {h.note}
                  </span>
                ) : null}
              </a>
            </Button>
          </li>
        ))}
      </ul>

      {card.next_step_hint ? (
        <p className="text-muted-foreground border-border border-t pt-3 text-sm leading-snug">
          {card.next_step_hint}
        </p>
      ) : null}

      <Button
        type="button"
        variant="outline"
        className="h-11 w-full"
        onClick={onDismiss}
      >
        Зрозуміло
      </Button>
    </div>
  );
}
