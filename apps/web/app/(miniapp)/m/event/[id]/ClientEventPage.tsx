// Client-side event page for the Mini App. We can't SSR this because the
// bearer token lives in sessionStorage — the same JS that bootstraps auth
// in TgInit also has to do this fetch.

"use client";

import { useCallback, useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CalendarClock, MapPin, Phone, Send } from "lucide-react";
import { formatEventDateTime, formatPrice } from "@/lib/format";
import { AccessibilityStrip } from "@/components/poruch/AccessibilityStrip";
import { WhoIsGoing } from "@/components/poruch/WhoIsGoing";
import {
  describeError,
  getOpportunity,
  getOpportunityAttendees,
  type AttendeeSummary,
  type OpportunityCard,
} from "@/lib/api";
import { useTelegramBackButton } from "@/lib/telegram/back-button";
import { EventActions } from "./EventActions";

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; event: OpportunityCard; attendees: AttendeeSummary };

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
        // apiFetch auto-exchanges initData and self-heals 401, so no
        // explicit auth dance here.
        const [event, attendees] = await Promise.all([
          getOpportunity(id),
          getOpportunityAttendees(id),
        ]);
        if (cancelled) return;
        setState({ kind: "ready", event, attendees });
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

  const { event, attendees } = state;
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
        <button
          type="button"
          onClick={onBack}
          aria-label="До стрічки"
          style={{ touchAction: "manipulation" }}
          className="absolute left-3 top-3 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm transition active:bg-black/55"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
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
          <div className="text-foreground space-y-3 whitespace-pre-line text-base">
            {event.description}
          </div>
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
          <p className="text-foreground inline-flex items-center gap-2 text-base">
            {event.organizer_contact.includes("@") ? (
              <Send className="h-4 w-4" aria-hidden />
            ) : (
              <Phone className="h-4 w-4" aria-hidden />
            )}
            {event.organizer_contact}
          </p>
        </section>
      ) : null}

      <EventActions
        eventId={event.id}
        eventTitle={event.title}
        eventStartAt={startDisplay}
        startedAlready={startedAlready(event.start_at)}
      />
    </main>
  );
}

function startedAlready(startAt: string | null): boolean {
  if (!startAt) return false;
  const t = Date.parse(startAt);
  return !Number.isNaN(t) && t < Date.now();
}
