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
  getMyInvitations,
  getOpportunity,
  getOpportunityAttendees,
  getRoom,
  type AttendeeSummary,
  type OpportunityCard,
  type V2EventRoom,
} from "@/lib/api";
import { useTelegramBackButton } from "@/lib/telegram/back-button";
import { EventActions } from "./EventActions";

type Attending =
  /** GET /opportunities/:id/room hasn't resolved yet. */
  | { kind: "loading" }
  /** No prior response — render the RSVP CTA. */
  | { kind: "no" }
  /** User is in event_attendees. `room` is null when the worker hasn't
   *  provisioned the chat yet (we'll keep showing "Чат готується…"). */
  | { kind: "yes"; room: V2EventRoom | null }
  /** Sticky decline: backend refuses re-accept (409 already_rsvped),
   *  so the only way back in is to contact the organizer. We swap the
   *  bottom bar for that affordance instead of leaving the user
   *  staring at a broken "Я буду". */
  | { kind: "declined" };

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
        // Four parallel calls so first paint is one-RTT:
        //   1. event itself (public)
        //   2. attendee count + names
        //   3. /room — 200 means attending, 403 means "no row in
        //      event_attendees", which covers BOTH "never responded"
        //      and "declined".
        //   4. /me/invitations (top page) — disambiguates 3 by
        //      finding a row for this event with response='declined'.
        //      Bounded to limit=50; users with hundreds of pending
        //      invitations would lose the signal here, but that's
        //      not a real shape today.
        const [event, attendees, roomResult, invitations] = await Promise.all([
          getOpportunity(id),
          getOpportunityAttendees(id),
          getRoom(id)
            .then((room) => ({ ok: true as const, room }))
            .catch((e: unknown) => ({ ok: false as const, error: e })),
          getMyInvitations({ limit: 50 }).catch(() => ({ items: [], next_cursor: null })),
        ]);
        if (cancelled) return;

        let attending: Attending;
        if (roomResult.ok) {
          attending = { kind: "yes", room: roomResult.room };
        } else {
          const inv = invitations.items.find((i) => i.event_id === id);
          if (inv?.response === "declined") {
            attending = { kind: "declined" };
          } else if (
            roomResult.error instanceof ApiError &&
            (roomResult.error.status === 403 || roomResult.error.status === 404)
          ) {
            attending = { kind: "no" };
          } else {
            // Backend hiccup — surface the RSVP CTA so the user can
            // still try; the action handler will retry.
            attending = { kind: "no" };
          }
        }

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
    <main className="bg-background flex flex-1 flex-col overflow-y-auto pb-32">
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
        <section className="space-y-1 px-4 pb-4">
          <h2 className="text-foreground text-lg font-semibold">Організатор</h2>
          <OrganizerLine raw={event.organizer_contact} />
        </section>
      ) : null}

      <EventActions
        eventId={event.id}
        eventTitle={event.title}
        eventStartAt={startDisplay}
        startedAlready={startedAlready(event.start_at)}
        organizerContact={event.organizer_contact}
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
 * a Telegram handle, a phone, an email, or "label · https://very/long/url".
 * We extract the first URL when there is one and show only the host as a
 * tappable link; otherwise fall back to autolinking the raw text.
 */
function OrganizerLine({ raw }: { raw: string }) {
  const url = extractFirstUrl(raw);
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
  return <Autolink text={raw} className="text-foreground block break-words text-base" />;
}

export type { Attending };
