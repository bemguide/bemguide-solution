// Empty / error state. Quiet illustration (just an icon for MVP), short title,
// optional CTA. Tone: matter-of-fact, not apologetic.

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <div className="bg-muted/40 border-border flex flex-col items-center justify-center gap-3 rounded-xl border px-6 py-10 text-center">
      <div className="text-muted-foreground" aria-hidden>
        {icon}
      </div>
      <h3 className="text-foreground text-base font-semibold">{title}</h3>
      {body ? <p className="text-muted-foreground max-w-xs text-sm">{body}</p> : null}
      {action}
    </div>
  );
}
