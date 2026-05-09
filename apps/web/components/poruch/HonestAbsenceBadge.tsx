// Inline single badge for "чесно немає" lines. Use sparingly — usually inside
// AccessibilityStrip, but available standalone for prose.

import { Ban } from "lucide-react";

export function HonestAbsenceBadge({ children }: { children: string }) {
  return (
    <span className="bg-honest-absence text-honest-absence-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs">
      <Ban className="h-3 w-3" aria-hidden />
      {children}
    </span>
  );
}
