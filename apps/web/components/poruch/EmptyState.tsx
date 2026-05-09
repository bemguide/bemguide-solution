// Empty / error state. Short title + optional body + optional CTA.
// Tone: matter-of-fact, not apologetic.

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  /** Optional decorative element above the title. Most callers omit it. */
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-muted/40 border-border flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-10 text-center">
      {icon ? (
        <div className="text-muted-foreground" aria-hidden>
          {icon}
        </div>
      ) : null}
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      {body ? <p className="text-muted-foreground max-w-xs text-sm">{body}</p> : null}
      {action}
    </div>
  );
}
