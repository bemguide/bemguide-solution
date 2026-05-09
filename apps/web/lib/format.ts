// Ukrainian-locale formatters for dates, distances, prices.

const TZ = "Europe/Kyiv";

export function formatEventDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", {
    timeZone: TZ,
    weekday: "short",
    day: "2-digit",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatRelativeWhen(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const diffMs = d.getTime() - now.getTime();
  const diffH = Math.round(diffMs / 36e5);
  const sameDay =
    d.toLocaleDateString("uk-UA", { timeZone: TZ }) ===
    now.toLocaleDateString("uk-UA", { timeZone: TZ });
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  const isTomorrow =
    d.toLocaleDateString("uk-UA", { timeZone: TZ }) ===
    tomorrow.toLocaleDateString("uk-UA", { timeZone: TZ });
  const time = d.toLocaleTimeString("uk-UA", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
  });

  if (diffH < 1 && diffH >= 0) return `за ${Math.max(1, Math.round(diffMs / 60000))} хв`;
  if (sameDay) return `Сьогодні ${time}`;
  if (isTomorrow) return `Завтра ${time}`;
  return formatEventDateTime(iso);
}

export function formatDistance(km: number | null | undefined): string | null {
  if (km == null) return null;
  if (km < 1) return `${Math.round(km * 1000)} м`;
  return `${km.toFixed(km < 10 ? 1 : 0)} км`;
}

export function formatPrice(uah: number): string {
  if (uah <= 0) return "Безкоштовно";
  return `${uah} ₴`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").toUpperCase();
}
