// Section header used in feed and admin. Title + optional subtitle + optional right action.

import type { ReactNode } from "react";

export function SectionHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-3 pb-3">
      <div>
        <h2 className="text-foreground text-xl font-semibold leading-tight">{title}</h2>
        {subtitle ? <p className="text-muted-foreground text-sm">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
