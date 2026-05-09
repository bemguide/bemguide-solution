// 3-segment progress bar for the onboarding header. Each segment fills as the
// user advances; the trailing "X з Y" caption keeps the affordance accessible.

import { cn } from "@/lib/utils";

export function StepProgress({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex flex-1 items-center gap-2">
      <div className="flex flex-1 items-center gap-1.5">
        {Array.from({ length: total }, (_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i < step ? "bg-primary" : "bg-secondary",
            )}
          />
        ))}
      </div>
      <span className="text-muted-foreground text-xs font-medium tabular-nums">
        {step} з {total}
      </span>
    </div>
  );
}
