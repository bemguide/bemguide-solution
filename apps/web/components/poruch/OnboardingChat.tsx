// Telegram-chat-style onboarding shell.
//
// Each step renders as a single-screen "thread": a header with the bot's
// identity, one or more bot bubbles asking the question, and an input
// area beneath (chips / text / disclosures). The primary CTA is sticky
// at the bottom; the optional skip is a text link below it.
//
// We deliberately don't show a stepper (`1/6`) inside the chat surface
// — the design treats each screen as a discrete chat moment, with the
// faint progress dots above the header giving just enough orientation
// that the user knows the conversation has a defined end.

"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OnboardingChat({
  step,
  total,
  primaryLabel,
  onPrimary,
  onSkip,
  skipLabel = "Пропустити",
  busy,
  children,
  primaryDisabled,
}: {
  step: number;
  total: number;
  primaryLabel: string;
  onPrimary: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  busy?: boolean;
  children: ReactNode;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="bg-background flex h-full flex-col">
      <ChatHeader step={step} total={total} />
      <main
        className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4 pt-3"
        style={{ scrollbarGutter: "stable" }}
      >
        {children}
      </main>
      <footer className="bg-background shrink-0 border-t border-border/40 px-5 pb-5 pt-3">
        <Button
          type="button"
          size="lg"
          className="h-13 w-full text-base font-semibold"
          style={{ height: "52px", touchAction: "manipulation" }}
          onClick={onPrimary}
          disabled={busy || primaryDisabled}
        >
          {primaryLabel}
        </Button>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            disabled={busy}
            className="text-muted-foreground hover:text-foreground -mb-1 mt-2 block w-full py-2 text-center text-sm underline-offset-4 hover:underline disabled:opacity-50"
            style={{ touchAction: "manipulation" }}
          >
            {skipLabel}
          </button>
        ) : null}
      </footer>
    </div>
  );
}

function ChatHeader({ step, total }: { step: number; total: number }) {
  return (
    <header className="bg-background shrink-0 border-b border-border/40 px-4 pb-2.5 pt-3">
      <div className="flex items-center gap-3">
        <div className="bg-primary text-primary-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-semibold">
          П
        </div>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="text-foreground text-sm font-semibold">Поруч</p>
          <p className="text-muted-foreground text-xs">bot · ветеранський збір</p>
        </div>
      </div>
      {total > 0 ? <ProgressDots step={step} total={total} /> : null}
    </header>
  );
}

/**
 * Faint dot row indicating progress through the conversation. Subtle
 * by design — the chat metaphor is the primary signal; this is a
 * reassurance, not a focal point.
 */
function ProgressDots({ step, total }: { step: number; total: number }) {
  return (
    <div className="mt-2.5 flex items-center gap-1.5" aria-hidden>
      {Array.from({ length: total + 1 }).map((_, i) => (
        <span
          key={i}
          className={cn(
            "h-1 flex-1 rounded-full transition-colors",
            i <= step ? "bg-primary/70" : "bg-border/60",
          )}
        />
      ))}
    </div>
  );
}

/** Bot question / statement — gray rounded bubble, left-aligned. */
export function BotBubble({ children }: { children: ReactNode }) {
  return (
    <div className="flex">
      <div className="bg-muted text-foreground max-w-[88%] whitespace-pre-line rounded-2xl rounded-tl-md px-4 py-2.5 text-[15px] leading-snug">
        {children}
      </div>
    </div>
  );
}

/**
 * Echo of the user's prior choice — right-aligned green chip styled
 * like a Telegram outgoing message. Used at the top of subsequent
 * steps to give continuity without rebuilding a full chat history.
 */
export function UserChip({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="bg-primary text-primary-foreground inline-flex max-w-[80%] items-center gap-1.5 rounded-2xl rounded-br-md px-3.5 py-2 text-sm font-medium">
        <span aria-hidden>🟢</span>
        <span className="truncate">{children}</span>
      </div>
    </div>
  );
}

/** Soft inset row used inside a step for sub-section labels. */
export function ChatLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground px-1 pt-1 text-xs font-semibold uppercase tracking-wider">
      {children}
    </p>
  );
}
