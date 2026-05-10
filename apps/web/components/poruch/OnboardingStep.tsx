// Step shell for /m/onboarding. Three regions:
//
//   header: optional back chevron + segmented progress strip — N+1
//           bars, the first `step+1` filled. No avatar, no bot label,
//           no copy: the bars are the only orientation cue.
//   main:   the question (plain heading) + the input controls.
//   footer: sticky primary CTA + optional skip.
//
// Tap targets are 48px+; the layout is locked to one TMA viewport so
// the keyboard pushing things up doesn't hide the CTA on long steps.

"use client";

import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function OnboardingStep({
  step,
  total,
  primaryLabel,
  onPrimary,
  onBack,
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
  /** Optional — when present, renders a back chevron in the header
   *  that jumps to the previous question. Telegram's native
   *  BackButton is wired to the same handler from OnboardingFlow. */
  onBack?: () => void;
  onSkip?: () => void;
  skipLabel?: string;
  busy?: boolean;
  children: ReactNode;
  primaryDisabled?: boolean;
}) {
  return (
    <div className="bg-background flex h-full flex-col">
      <SegmentedProgress step={step} total={total} onBack={onBack} />
      <main
        className="flex flex-1 flex-col gap-4 overflow-y-auto px-5 pb-4 pt-4"
        style={{ scrollbarGutter: "stable" }}
      >
        {children}
      </main>
      <footer className="bg-background shrink-0 px-5 pb-5 pt-3">
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

/**
 * Render `total` bars (one per question). The first `step + 1` are
 * filled with primary; the rest stay muted. When `onBack` is
 * provided, a chevron-left button sits inline to the left of the
 * bars — visually paired with the bars so users see "step back" in
 * the same orientation cue, and accessible to keyboard / non-TG
 * surfaces that don't get the SDK BackButton.
 *
 * Convention: pass `step = -1` on the greeting screen (zero-Q) so no
 * bars are filled yet, then `step = 0..total-1` for each question,
 * filling 1..total bars as the user advances.
 */
function SegmentedProgress({
  step,
  total,
  onBack,
}: {
  step: number;
  total: number;
  onBack?: () => void;
}) {
  return (
    <div
      className="bg-background shrink-0 px-5 pb-3 pt-4"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={total}
      aria-valuenow={Math.max(0, step + 1)}
    >
      <div className="flex items-center gap-2">
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад"
            className="text-muted-foreground hover:text-foreground hover:bg-muted -ml-1.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-colors"
            style={{ touchAction: "manipulation" }}
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
        <div className="flex flex-1 items-center gap-1">
          {Array.from({ length: total }).map((_, i) => (
            <span
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                i <= step ? "bg-primary" : "bg-border/60",
              )}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

/** Question heading. Same role the bot bubble used to play, no chrome. */
export function StepHeading({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-foreground text-2xl font-semibold leading-tight tracking-tight">
      {children}
    </h2>
  );
}

/** Optional secondary line below the heading. */
export function StepSubheading({ children }: { children: ReactNode }) {
  return <p className="text-muted-foreground text-sm leading-snug">{children}</p>;
}

/** Sub-section label inside multi-section steps (Comfort, About). */
export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
      {children}
    </p>
  );
}
