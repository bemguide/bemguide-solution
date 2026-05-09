// Public event page (`/event/[id]`).
// SSR. No login required — built for sharing via Viber/Telegram/Instagram.
// The "Я буду" button deep-links into the bot for users who aren't already in the Mini App.

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, MapPin, Phone, Send } from "lucide-react";
import type { Metadata } from "next";
import { serverEnv } from "@/lib/env";
import { formatEventDateTime, formatPrice } from "@/lib/format";
import { AccessibilityStrip } from "@/components/poruch/AccessibilityStrip";
import { WhoIsGoing } from "@/components/poruch/WhoIsGoing";
import { ApiError, type AttendeeSummary, type OpportunityCard } from "@/lib/api";
import { serverGet } from "@/lib/api/server";
import { CtaBar } from "./CtaBar";

async function fetchEvent(id: string): Promise<OpportunityCard | null> {
  try {
    return await serverGet<OpportunityCard>(`/opportunities/${id}`, { revalidate: 60 });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

async function fetchAttendees(id: string): Promise<AttendeeSummary> {
  try {
    return await serverGet<AttendeeSummary>(`/opportunities/${id}/attendees`, { revalidate: 30 });
  } catch {
    return { count: 0, names_visible: [] };
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const event = await fetchEvent(id).catch(() => null);
  if (!event) return { title: "Поруч" };
  return {
    title: `${event.title} — Поруч`,
    description: event.short_description ?? event.description?.slice(0, 160) ?? undefined,
    openGraph: {
      title: event.title,
      description: event.short_description ?? undefined,
      images: event.photo_url ? [{ url: event.photo_url }] : undefined,
      locale: "uk_UA",
      type: "website",
    },
  };
}

export const dynamic = "force-dynamic";

export default async function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await fetchEvent(id);
  if (!event) notFound();

  const startMs = event.start_at ? Date.parse(event.start_at) : NaN;
  const endMs =
    !Number.isNaN(startMs) && event.duration_min
      ? startMs + event.duration_min * 60_000
      : NaN;
  const eventEnded = !Number.isNaN(endMs) && endMs < Date.now();

  const attendees = await fetchAttendees(id);

  const env = serverEnv();
  const botUsername = process.env.TELEGRAM_BOT_USERNAME ?? "";
  const deepLink = botUsername
    ? `https://t.me/${botUsername}?start=evt_${event.id}`
    : `${env.NEXT_PUBLIC_APP_URL}/m/event/${event.id}`;
  const deferLink = botUsername
    ? `https://t.me/${botUsername}?start=defer_${event.id}`
    : deepLink;
  const shareUrl = `${env.NEXT_PUBLIC_APP_URL}/event/${event.id}`;

  return (
    <main className="bg-background mx-auto flex min-h-screen w-full max-w-md flex-col pb-32">
      {/* Hero */}
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
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/30 to-transparent"
          aria-hidden
        />
        <div className="absolute bottom-4 left-4 right-4 space-y-1 text-white">
          <h1 className="text-2xl font-semibold leading-tight">{event.title}</h1>
          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <CalendarClock className="h-4 w-4" aria-hidden />
            <span>{formatEventDateTime(event.start_at ?? "")}</span>
            <span aria-hidden>·</span>
            <span>{event.city}</span>
            <span aria-hidden>·</span>
            <span>{formatPrice(event.price_uah ?? 0)}</span>
          </p>
        </div>
      </div>

      {eventEnded ? (
        <div className="bg-muted text-muted-foreground border-border mx-4 mt-3 rounded-md border p-3 text-sm">
          Цей вже відбувся.
        </div>
      ) : null}

      {/* Accessibility strip */}
      <section className="px-4 py-4">
        <AccessibilityStrip flags={event.accessibility_flags} honestAbsences={null} />
      </section>

      {/* Description */}
      {event.description ? (
        <section className="space-y-2 px-4 pb-4">
          <h2 className="text-foreground text-lg font-semibold">Що там буде</h2>
          <div className="text-foreground space-y-3 whitespace-pre-line text-base">
            {event.description}
          </div>
        </section>
      ) : null}

      {/* Who is going */}
      <section className="space-y-2 px-4 pb-4">
        <h2 className="text-foreground text-lg font-semibold">Хто йде</h2>
        {attendees.count > 0 ? (
          <WhoIsGoing
            count={attendees.count}
            namesVisible={attendees.names_visible.slice(0, 6)}
          />
        ) : (
          <p className="text-muted-foreground text-sm">
            Поки нікого. Будеш першим — інші підтягнуться.
          </p>
        )}
      </section>

      {/* Address / map link */}
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

      {/* Organizer contact */}
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

      {/* CTA bar */}
      {!eventEnded ? (
        <CtaBar
          deepLink={deepLink}
          deferLink={deferLink}
          shareUrl={shareUrl}
          shareTitle={event.title}
        />
      ) : null}
    </main>
  );
}
