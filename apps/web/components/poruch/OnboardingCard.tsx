// Step card used by the miniapp onboarding flow.
// Three regions: header (shrink-0), scrollable main, sticky footer with the
// primary CTA. The sticky footer means the button stays reachable when the
// keyboard opens — critical for /m/onboarding, where every step ends with a tap.

"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";

export function OnboardingCard({
  step,
  total,
  title,
  subtitle,
  children,
  primaryLabel,
  onPrimary,
  onSkip,
  busy,
}: {
  step: number;
  total: number;
  title: string;
  subtitle?: string;
  children: ReactNode;
  primaryLabel: string;
  onPrimary: () => void;
  onSkip?: () => void;
  busy?: boolean;
}) {
  return (
    <div className="bg-background flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between px-5 pb-2 pt-5">
        <span className="text-muted-foreground text-xs font-medium">
          {step} з {total}
        </span>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-muted-foreground hover:text-foreground -m-2 p-2 text-sm underline-offset-2 hover:underline"
            style={{ touchAction: "manipulation" }}
          >
            Пропустити
          </button>
        ) : null}
      </header>
      <main className="flex flex-1 flex-col gap-5 overflow-y-auto px-6 pb-3 pt-3">
        <div className="space-y-2">
          <h1 className="text-foreground text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        <div className="flex-1">{children}</div>
      </main>
      <div className="bg-background border-border/50 shrink-0 border-t px-6 pb-4 pt-3">
        <Button
          type="button"
          size="lg"
          className="h-14 w-full text-base font-semibold"
          onClick={onPrimary}
          disabled={busy}
          style={{ touchAction: "manipulation" }}
        >
          {primaryLabel}
        </Button>
      </div>
    </div>
  );
}
