// Full-screen step card used by the miniapp onboarding flow.
// Self-contained: progress chip, "Skip" link, slot for content, primary CTA.

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
    <div className="bg-background flex min-h-screen flex-col">
      <header className="flex items-center justify-between px-5 pt-5">
        <span className="text-muted-foreground text-xs font-medium">
          {step} з {total}
        </span>
        {onSkip ? (
          <button
            type="button"
            onClick={onSkip}
            className="text-muted-foreground text-sm underline-offset-2 hover:underline"
          >
            Пропустити
          </button>
        ) : null}
      </header>
      <main className="flex flex-1 flex-col gap-6 px-6 pb-8 pt-6">
        <div className="space-y-2">
          <h1 className="text-foreground text-2xl font-semibold leading-tight">{title}</h1>
          {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
        </div>
        <div className="flex-1">{children}</div>
        <Button
          type="button"
          size="lg"
          className="h-14 w-full text-base font-semibold"
          onClick={onPrimary}
          disabled={busy}
        >
          {primaryLabel}
        </Button>
      </main>
    </div>
  );
}
