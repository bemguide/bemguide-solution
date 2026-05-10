// Client-side event page for the Mini App. We can't SSR this because the
// bearer token lives in sessionStorage — the same JS that bootstraps auth
// in TgInit also has to do this fetch.

"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarClock, MapPin } from "lucide-react";
import { formatEventDateTime, formatPrice } from "@/lib/format";
import { AccessibilityStrip } from "@/components/poruch/AccessibilityStrip";
import { Autolink } from "@/components/poruch/Autolink";
import { WhoIsGoing } from "@/components/poruch/WhoIsGoing";
import { extractFirstUrl, prettyUrlHost } from "@/lib/url";
import {
  ApiError,
  describeError,
  getOpportunity,
  getOpportunityAttendees,
  getRoom,
  type AttendeeSummary,
  type OpportunityCard,
  type V2EventRoom,
} from "@/lib/api";
import { useTelegramBackButton } from "@/lib/telegram/back-button";
import { EventActions } from "./EventActions";
import { OrganizerCheckIn } from "./OrganizerCheckIn";

type Attending =
  /** GET /opportunities/:id/room hasn't resolved yet. */
  | { kind: "loading" }
  /** No prior response — render the RSVP CTA. Backend's `fix(rsvp):
   *  allow re-subscribing after decline` made this branch the
   *  destination for both "never RSVPed" and "previously declined"
   *  users; the dedicated declined-state UI is gone. */
  | { kind: "no" }
  /** User is in event_attendees. `room` is null when the bot hasn't
   *  attached a chat yet — we still surface the QR + share, the
   *  "Чат події" link only appears once the bot has posted. */
  | { kind: "yes"; room: V2EventRoom | null };

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | {
      kind: "ready";
      event: OpportunityCard;
      attendees: AttendeeSummary;
      attending: Attending;
    };

export function ClientEventPage({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  // Telegram's native top-bar BackButton (mobile + tdesktop). No-op
  // when running outside the WebApp; the visible overlay arrow on
  // the hero is the universal fallback.
  const onBack = useCallback(() => router.push("/m/feed"), [router]);
  useTelegramBackButton(onBack);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Three parallel calls so first paint is one-RTT:
        //   1. event itself (public)
        //   2. attendee count + names
        //   3. /room — 200 means attending, 403/404 means not. Used
        //      to be 4 calls (also /me/invitations to disambiguate
        //      "declined"), but backend dropped sticky-decline so
        //      that probe is no longer needed.
        const [event, attendees, attending] = await Promise.all([
          getOpportunity(id),
          getOpportunityAttendees(id),
          getRoom(id)
            .then<Attending>((room) => ({ kind: "yes", room }))
            .catch<Attending>((e: unknown) => {
              if (e instanceof ApiError && (e.status === 403 || e.status === 404)) {
                return { kind: "no" };
              }
              // Backend hiccup — surface the RSVP CTA anyway so the
              // user can still try; the action handler will retry.
              return { kind: "no" };
            }),
        ]);
        if (cancelled) return;
        setState({ kind: "ready", event, attendees, attending });
      } catch (e) {
        if (cancelled) return;
        setState({ kind: "error", message: describeError(e) });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (state.kind === "loading") {
    return (
      <main className="flex flex-1 flex-col gap-3 px-4 pt-4">
        <div className="bg-muted aspect-[16/10] w-full animate-pulse rounded-xl" />
        <div className="bg-muted h-5 w-2/3 animate-pulse rounded" />
        <div className="bg-muted h-4 w-1/2 animate-pulse rounded" />
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="px-4 py-10 text-center">
        <p className="text-foreground text-base">{state.message}</p>
        <Link
          href="/m/feed"
          className="text-primary mt-4 inline-block text-sm underline-offset-2 hover:underline"
        >
          До стрічки
        </Link>
      </main>
    );
  }

  const { event, attendees, attending } = state;
  const startDisplay = event.start_at ?? "";

  return (
    // pb-48 leaves clearance for the tallest variant of the fixed
    // bottom action bar (DeclinedBar: status line + big CTA + share
    // + py-3 = ~150px) plus a small breathing gap above it. Also
    // accounts for `--tg-safe-area-inset-bottom` overlap on phones
    // with a home indicator.
    <main className="bg-background flex flex-1 flex-col overflow-y-auto pb-48">
      <div className="relative aspect-[16/10] w-full overflow-hidden">
        {event.photo_url ? (
          <Image
            src={event.photo_url}
            alt={event.title}
            fill
            sizes="(max-width: 768px) 100vw, 480px"
            priority
            className="object-cover"
          />
        ) : (
          <div className="bg-muted h-full w-full" aria-hidden />
        )}
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
          aria-hidden
        />
        <div className="absolute bottom-4 left-4 right-4 space-y-1 text-white">
          <h1 className="text-2xl font-semibold leading-tight">{event.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <CalendarClock className="h-4 w-4" aria-hidden />
            <span>{formatEventDateTime(startDisplay)}</span>
            <span aria-hidden>·</span>
            <span>{event.city}</span>
            <span aria-hidden>·</span>
            <span>{formatPrice(event.price_uah ?? 0)}</span>
          </p>
        </div>
      </div>

      <section className="px-4 py-4">
        <AccessibilityStrip flags={event.accessibility_flags} honestAbsences={null} />
      </section>

      {event.description ? (
        <section className="space-y-2 px-4 pb-4">
          <h2 className="text-foreground text-lg font-semibold">Що там буде</h2>
          <Autolink
            text={event.description}
            className="text-foreground block whitespace-pre-line break-words text-base"
          />
        </section>
      ) : null}

      <section className="space-y-2 px-4 pb-4">
        <h2 className="text-foreground text-lg font-semibold">Хто йде</h2>
        {attendees.count > 0 ? (
          <WhoIsGoing count={attendees.count} namesVisible={attendees.names_visible.slice(0, 6)} />
        ) : (
          <p className="text-muted-foreground text-sm">
            Поки нікого. Будеш першим — інші підтягнуться.
          </p>
        )}
      </section>

      {event.address ? (
        <section className="space-y-1 px-4 pb-4">
          <h2 className="text-foreground text-lg font-semibold">Адреса</h2>
          <Link
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              `${event.city} ${event.address}`,
            )}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground inline-flex items-start gap-2 text-base underline-offset-2 hover:underline"
          >
            <MapPin className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
            {event.address}
          </Link>
        </section>
      ) : null}

      {event.organizer_contact ? (
        <section className="space-y-2 px-4 pb-4 pt-2">
          <h2 className="text-foreground text-lg font-semibold">Організатор</h2>
          <OrganizerLine raw={event.organizer_contact} />
        </section>
      ) : null}

      {/* Organizer-only — heuristic: their TG @username matches the
          organizer_contact field. Backend doesn't yet store creator
          on the row, so this is the closest "is this user running
          the event?" signal we have client-side. */}
      <OrganizerCheckIn
        eventId={event.id}
        organizerContact={event.organizer_contact}
      />

      <EventActions
        eventId={event.id}
        eventTitle={event.title}
        eventStartAt={startDisplay}
        startedAlready={startedAlready(event.start_at)}
        city={event.city}
        attending={attending}
        onAttendingChange={(next) => {
          setState((s) => (s.kind === "ready" ? { ...s, attending: next } : s));
        }}
      />
    </main>
  );
}

function startedAlready(startAt: string | null): boolean {
  if (!startAt) return false;
  const t = Date.parse(startAt);
  return !Number.isNaN(t) && t < Date.now();
}

/**
 * `organizer_contact` is free text on the backend — could be plain prose,
 * a Telegram handle (`@username`), a phone, an email, or
 * "label · https://very/long/url". Render in this priority order:
 *   1. Embedded URL → host-only link via prettyUrlHost.
 *   2. Bare TG handle (`@username`) → t.me/<username> link, label keeps `@`.
 *   3. Anything else → Autolink (linkifies any URLs inside, leaves
 *      the rest as plain text).
 */
const TG_HANDLE_RE = /^@([a-zA-Z][a-zA-Z0-9_]{3,31})$/;

function OrganizerLine({ raw }: { raw: string }) {
  const trimmed = raw.trim();
  const url = extractFirstUrl(trimmed);
  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center break-words text-base underline underline-offset-2 hover:no-underline"
      >
        {prettyUrlHost(url)}
      </a>
    );
  }
  const tgMatch = trimmed.match(TG_HANDLE_RE);
  if (tgMatch) {
    return (
      <a
        href={`https://t.me/${tgMatch[1]}`}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center text-base underline underline-offset-2 hover:no-underline"
      >
        @{tgMatch[1]}
      </a>
    );
  }
  return <Autolink text={raw} className="text-foreground block break-words text-base" />;
}

export type { Attending };
