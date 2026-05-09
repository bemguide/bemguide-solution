// /m/event/[slug] — miniapp event page.
// Same layout as the public page (M8) plus a "чому це для тебе" AI block at the
// top and a miniapp-style RSVP modal hooked to /api/rsvp/create.

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, MapPin, Phone, Send } from "lucide-react";
import type { Metadata } from "next";
import { getEventBySlug, getPublicRsvpCount } from "@/lib/queries";
import { formatEventDateTime, formatPrice } from "@/lib/format";
import { AccessibilityStrip } from "@/components/poruch/AccessibilityStrip";
import { WhoIsGoing } from "@/components/poruch/WhoIsGoing";
import { EventActions } from "./EventActions";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = await getEventBySlug(slug).catch(() => null);
  if (!event) return { title: "Поруч" };
  return { title: `${event.title} — Поруч`, robots: { index: false } };
}

export const dynamic = "force-dynamic";

export default async function MiniappEventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = await getEventBySlug(slug);
  if (!event) notFound();

  const rsvp = await getPublicRsvpCount(event.id);

  return (
    <main className="bg-background flex flex-1 flex-col pb-32">
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
            <span>{formatEventDateTime(event.start_at)}</span>
            <span aria-hidden>·</span>
            <span>{event.city}</span>
            <span aria-hidden>·</span>
            <span>{formatPrice(event.price_uah)}</span>
          </p>
        </div>
      </div>

      <section className="px-4 py-4">
        <AccessibilityStrip
          flags={event.accessibility_flags}
          honestAbsences={event.honest_absences}
        />
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
        {rsvp.going_count > 0 ? (
          <WhoIsGoing count={rsvp.going_count} namesVisible={rsvp.names_visible.slice(0, 6)} />
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
        eventSlug={event.slug}
        eventTitle={event.title}
        eventStartAt={event.start_at}
      />
    </main>
  );
}
