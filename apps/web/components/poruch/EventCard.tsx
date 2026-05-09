// Three variants of EventCard.
// - featured: large 16:9 photo, AI reason chip, social proof, accessibility chips.
//   Used at the top of the feed ("Сьогодні і завтра поруч").
// - compact: 80×80 thumbnail row. Used in "Цього тижня" section.
// - mini: text-only, for share previews / map info windows.

import Link from "next/link";
import Image from "next/image";
import type { EventForDisplay } from "@/lib/types";
import { formatRelativeWhen, formatDistance, formatPrice } from "@/lib/format";
import { AccessibilityChips } from "./AccessibilityStrip";
import { AiReasonChip } from "./AiReasonChip";
import { SocialProofLine } from "./SocialProofLine";

type CardLink = { href: string; prefetch?: boolean };

function eventLink(slug: string, surface: "public" | "miniapp"): CardLink {
  return { href: surface === "miniapp" ? `/m/event/${slug}` : `/event/${slug}` };
}

export function FeaturedEventCard({
  event,
  surface,
}: {
  event: EventForDisplay;
  surface: "public" | "miniapp";
}) {
  const { href } = eventLink(event.slug, surface);
  return (
    <Link
      href={href}
      className="bg-card border-border focus-visible:ring-ring block overflow-hidden rounded-xl border transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2"
    >
      <div className="bg-muted relative aspect-[16/9] w-full">
        {event.photo_url ? (
          <Image
            src={event.photo_url}
            alt={event.title}
            fill
            sizes="(max-width: 768px) 100vw, 480px"
            className="object-cover"
            priority={false}
          />
        ) : null}
      </div>
      <div className="space-y-2 p-3">
        <div className="space-y-1">
          <h3 className="text-foreground line-clamp-2 text-base font-semibold leading-snug">
            {event.title}
          </h3>
          <p className="text-muted-foreground flex items-center gap-1 text-sm">
            <span>{formatRelativeWhen(event.start_at)}</span>
            {formatDistance(event.distance_km) ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatDistance(event.distance_km)}</span>
              </>
            ) : (
              <>
                <span aria-hidden>·</span>
                <span>{event.city}</span>
              </>
            )}
            <span aria-hidden>·</span>
            <span>{formatPrice(event.price_uah)}</span>
          </p>
        </div>
        {event.accessibility_flags.length ? (
          <AccessibilityChips flags={event.accessibility_flags} />
        ) : null}
        {event.going_count != null && event.going_count > 0 ? (
          <SocialProofLine text={socialProofString(event)} />
        ) : null}
        {event.ai_reason ? <AiReasonChip reason={event.ai_reason} /> : null}
      </div>
    </Link>
  );
}

export function CompactEventCard({
  event,
  surface,
}: {
  event: EventForDisplay;
  surface: "public" | "miniapp";
}) {
  const { href } = eventLink(event.slug, surface);
  return (
    <Link
      href={href}
      className="bg-card border-border focus-visible:ring-ring flex items-center gap-3 rounded-lg border p-2.5 transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2"
    >
      <div className="bg-muted relative h-20 w-20 shrink-0 overflow-hidden rounded-md">
        {event.photo_url ? (
          <Image
            src={event.photo_url}
            alt=""
            fill
            sizes="80px"
            className="object-cover"
            aria-hidden
          />
        ) : null}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <h4 className="text-foreground line-clamp-2 text-sm font-semibold leading-snug">
          {event.title}
        </h4>
        <p className="text-muted-foreground text-xs">
          {formatRelativeWhen(event.start_at)}
          {formatDistance(event.distance_km) ? ` · ${formatDistance(event.distance_km)}` : ""}
        </p>
        <AccessibilityChips flags={event.accessibility_flags} max={2} />
      </div>
    </Link>
  );
}

export function MiniEventCard({
  event,
  surface,
}: {
  event: EventForDisplay;
  surface: "public" | "miniapp";
}) {
  const { href } = eventLink(event.slug, surface);
  return (
    <Link href={href} className="text-foreground block underline-offset-2 hover:underline">
      <strong className="font-semibold">{event.title}</strong>{" "}
      <span className="text-muted-foreground text-sm">— {formatRelativeWhen(event.start_at)}</span>
    </Link>
  );
}

function socialProofString(event: EventForDisplay): string {
  const count = event.going_count ?? 0;
  const names = event.names_visible ?? [];
  if (count === 0) return "";
  if (names.length === 0) return `${count} ветеранів іде`;
  if (names.length === 1) return `${names[0]} іде` + (count > 1 ? ` · і ще ${count - 1}` : "");
  const head = names.slice(0, 2).join(", ");
  const rest = count - names.length;
  return rest > 0 ? `${head}, і ще ${rest}` : `${head} йдуть`;
}
