// Three-button CTA stack used at the bottom of public + miniapp event pages.
// Primary: "Я буду" — full-width, 60px tall.
// Secondary row: "Поділитися" + "Не зараз — нагадай" (defer button is non-negotiable per spec).

"use client";

import { Bell, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function RsvpCta({
  primaryLabel = "Я буду",
  onConfirm,
  onShare,
  onDefer,
  disabled,
  variant = "miniapp",
}: {
  primaryLabel?: string;
  onConfirm: () => void;
  onShare?: () => void;
  onDefer?: () => void;
  disabled?: boolean;
  variant?: "miniapp" | "public";
}) {
  return (
    <div className="space-y-2">
      <Button
        type="button"
        size="lg"
        className="h-14 w-full text-base font-semibold"
        onClick={onConfirm}
        disabled={disabled}
      >
        {primaryLabel}
      </Button>
      <div className="grid grid-cols-2 gap-2">
        {onShare ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onShare}
            aria-label="Поділитися посиланням"
          >
            <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
            Поділитися
          </Button>
        ) : null}
        {onDefer ? (
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={onDefer}
            aria-label="Не зараз — нагадай через тиждень"
          >
            <Bell className="mr-1.5 h-4 w-4" aria-hidden />
            Не зараз
          </Button>
        ) : null}
      </div>
      {variant === "public" ? (
        <p className="text-muted-foreground text-center text-xs">
          {/* deep-link copy: opens bot with start param if not already in mini app */}
          Без реєстрації. Відкриється у Telegram.
        </p>
      ) : null}
    </div>
  );
}
