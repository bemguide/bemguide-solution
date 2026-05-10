// "Хто йде" social proof. Shows count + optional initials avatars when veterans
// have explicitly opted in to public visibility. Falls back to count-only.

import { initials } from "@/lib/format";

export function WhoIsGoing({
  count,
  namesVisible,
}: {
  count: number;
  namesVisible: readonly string[];
}) {
  if (count === 0) return null;
  const visible = namesVisible.slice(0, 4);
  const hiddenCount = count - visible.length;
  return (
    <div className="flex items-center gap-3">
      <div className="flex -space-x-1.5">
        {visible.map((name) => (
          <span
            key={name}
            className="bg-accent text-accent-foreground border-card flex h-7 w-7 items-center justify-center rounded-full border-2 text-xs font-semibold"
            aria-label={name}
          >
            {initials(name)}
          </span>
        ))}
        {hiddenCount > 0 ? (
          <span className="bg-muted text-muted-foreground border-card flex h-7 w-7 items-center justify-center rounded-full border-2 text-[0.6875rem] font-semibold">
            +{hiddenCount}
          </span>
        ) : null}
      </div>
      <div className="text-foreground flex flex-col">
        <span className="text-sm font-semibold">{formatCount(count)}</span>
        <span className="text-muted-foreground text-[0.6875rem] leading-tight">
          {namesVisible.length
            ? "Імена бачать тільки записані ветерани"
            : "Імена приховані за замовчуванням"}
        </span>
      </div>
    </div>
  );
}

function formatCount(n: number): string {
  if (n === 0) return "Поки нікого";
  if (n === 1) return "1 ветеран іде";
  // 2–4 form
  const last2 = n % 100;
  const last1 = n % 10;
  if (last2 >= 11 && last2 <= 14) return `${n} ветеранів іде`;
  if (last1 >= 2 && last1 <= 4) return `${n} ветерани йдуть`;
  return `${n} ветеранів іде`;
}
