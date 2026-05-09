// Chip group that filters the feed/map by accessibility flags.

"use client";

import type { AccessibilityFlag } from "@poruch/shared";
import { ACCESSIBILITY_LABELS_UK } from "@poruch/shared";
import { cn } from "@/lib/utils";

export function AccessibilityFilter({
  options,
  selected,
  onToggle,
}: {
  options: readonly AccessibilityFlag[];
  selected: readonly AccessibilityFlag[];
  onToggle: (flag: AccessibilityFlag) => void;
}) {
  const set = new Set(selected);
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((flag) => {
        const active = set.has(flag);
        return (
          <button
            key={flag}
            type="button"
            onClick={() => onToggle(flag)}
            className={cn(
              "min-h-9 rounded-full border px-3 text-sm transition",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-muted",
            )}
            aria-pressed={active}
          >
            {ACCESSIBILITY_LABELS_UK[flag]}
          </button>
        );
      })}
    </div>
  );
}
