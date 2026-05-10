// Client-side detail view for a health resource (`opportunity_health`).
//
// The backend only exposes these rows through the filtered feed —
// there's no `GET /opportunity_health/:id` endpoint today — so the
// detail page re-fetches the same `?filter=health` payload the feed
// already used and finds the row by id. ≤30 rows, served from
// PostgREST with a heavy index, so this is cheap enough for V0;
// once a single-resource endpoint lands we swap the lookup for a
// direct fetch and delete the find().
//
// UX-wise this is the place ProgramCard / PlaceCard navigates the
// user to instead of straight to Google Maps. Maps is still
// reachable via an explicit "Маршрут" button — but it's a chosen
// action, not the default tap.

"use client";

import { useCallback, useEffect, useState } from "react";
import { RemoteImage } from "@/components/poruch/RemoteImage";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { MapPin, Navigation, Users } from "lucide-react";
import { ACCESSIBILITY_LABELS_UK } from "@poruch/shared";
import { Button } from "@/components/ui/button";
import { Autolink } from "@/components/poruch/Autolink";
import {
  describeError,
  getFeed,
  isNoTelegramEnv,
  logApiError,
  type OpportunityHealthCard,
} from "@/lib/api";
import { useTelegramBackButton } from "@/lib/telegram/back-button";

type State =
  | { kind: "loading" }
  | { kind: "ready"; place: OpportunityHealthCard }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

function buildMapsUrl(place: OpportunityHealthCard): string {
  if (place.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
      `${place.city} ${place.address}`,
    )}`;
  }
  if (place.location_lat !== null && place.location_lng !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${place.location_lat},${place.location_lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.title)}`;
}

export function PlaceDetailClient({ id }: { id: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "loading" });

  const onBack = useCallback(() => router.push("/m/feed"), [router]);
  useTelegramBackButton(onBack);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await getFeed({ filter: "health" });
        if (cancelled) return;
        const place = res.items.find(
          (item): item is OpportunityHealthCard & { source: "opportunity_health" } =>
            item.source === "opportunity_health" && item.id === id,
        );
        if (!place) {
          setState({ kind: "not-found" });
          return;
        }
        setState({ kind: "ready", place });
      } catch (e) {
        if (cancelled) return;
        logApiError("place.detail", e);
        if (isNoTelegramEnv(e)) {
          setState({ kind: "error", message: "Відкрий додаток у Telegram." });
          return;
        }
        setState({ kind: "error", message: describeError(e, "feed") });
      }
    })();
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

  if (state.kind === "not-found") {
    return (
      <main className="px-4 py-10 text-center">
        <p className="text-foreground text-base">Цей ресурс зараз недоступний.</p>
        <Link
          href="/m/feed"
          className="text-primary mt-4 inline-block text-sm underline-offset-2 hover:underline"
        >
          До стрічки
        </Link>
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

  const { place } = state;
  const addressLine = [place.city, place.address].filter(Boolean).join(", ");
  const mapsUrl = buildMapsUrl(place);

  return (
    <main className="bg-background flex flex-1 flex-col overflow-y-auto pb-32">
      <div className="bg-muted relative aspect-[16/10] w-full overflow-hidden">
        <RemoteImage src={place.photo_url} alt={place.title} priority />
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/70 via-black/20 to-transparent"
          aria-hidden
        />
        <div className="absolute bottom-4 left-4 right-4 space-y-1 text-white">
          <h1 className="text-2xl font-semibold leading-tight">{place.title}</h1>
          {addressLine ? (
            <p className="inline-flex items-center gap-1.5 text-sm">
              <MapPin className="h-4 w-4" aria-hidden />
              <span className="truncate">{addressLine}</span>
            </p>
          ) : null}
        </div>
      </div>

      {place.short_description ? (
        <section className="space-y-2 px-4 pb-2 pt-4">
          <p className="text-foreground text-base leading-relaxed">
            {place.short_description}
          </p>
        </section>
      ) : null}

      {place.description ? (
        <section className="space-y-2 px-4 pb-4 pt-2">
          <h2 className="text-foreground text-lg font-semibold">Що тут</h2>
          <Autolink
            text={place.description}
            className="text-foreground block whitespace-pre-line break-words text-base"
          />
        </section>
      ) : null}

      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 pb-2 text-sm">
        {place.visit_count > 0 ? (
          <span className="text-muted-foreground inline-flex items-center gap-1.5">
            <Users className="h-4 w-4" aria-hidden />
            {place.visit_count} перевідвідували
          </span>
        ) : null}
        {place.accessibility_flags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {place.accessibility_flags.map((f) => (
              <span
                key={f}
                className="text-accent-foreground bg-accent rounded-md px-2 py-0.5 text-xs"
              >
                {ACCESSIBILITY_LABELS_UK[f]}
              </span>
            ))}
          </div>
        ) : null}
      </section>

      {place.organizer_contact ? (
        <section className="space-y-2 px-4 pb-4 pt-2">
          <h2 className="text-foreground text-lg font-semibold">Контакт</h2>
          <Autolink
            text={place.organizer_contact}
            className="text-foreground block break-words text-base"
          />
        </section>
      ) : null}

      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
        <Button asChild size="lg" className="h-12 w-full">
          <a href={mapsUrl} target="_blank" rel="noopener noreferrer">
            <Navigation className="mr-2 h-5 w-5" aria-hidden />
            Маршрут
          </a>
        </Button>
      </div>
    </main>
  );
}
