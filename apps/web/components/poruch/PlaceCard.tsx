// Card variant for `opportunity_health` rows surfaced via
// `GET /feed?filter=health`. Static resources — no schedule, no
// RSVP, no attendee list. Anchored on address + visit_count.
//
// Tap target: the whole card is a Next Link to the dedicated detail
// page at `/m/place/[id]`, matching the convention every other feed
// card follows (opportunity → /m/event/[id]). Maps used to fire on
// any tap, which broke the model — users couldn't see the rest of
// the place's info without leaving the app. The detail page now
// owns the maps action via a "Маршрут" button.

import Image from "next/image";
import Link from "next/link";
import { MapPin, Users } from "lucide-react";
import { ACCESSIBILITY_LABELS_UK } from "@poruch/shared";
import type { OpportunityHealthCard } from "@/lib/api";
import { Autolink } from "./Autolink";

export function PlaceCard({ place }: { place: OpportunityHealthCard }) {
  return (
    <Link
      href={`/m/place/${place.id}`}
      className="bg-card border-border focus-visible:ring-ring block overflow-hidden rounded-xl border transition hover:shadow-sm focus-visible:outline-none focus-visible:ring-2"
    >
      {place.photo_url ? (
        <div className="bg-muted relative aspect-[16/9] w-full">
          <Image
            src={place.photo_url}
            alt={place.title}
            fill
            sizes="(max-width: 768px) 100vw, 480px"
            className="object-cover"
          />
        </div>
      ) : null}
      <div className="space-y-2 p-3">
        <div className="space-y-1">
          <h3 className="text-foreground line-clamp-2 text-base font-semibold leading-snug">
            {place.title}
          </h3>
          <p className="text-muted-foreground inline-flex items-center gap-1 text-sm">
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            <span className="truncate">
              {[place.city, place.address].filter(Boolean).join(", ")}
            </span>
          </p>
        </div>

        {place.short_description ? (
          <p className="text-foreground line-clamp-2 text-sm">{place.short_description}</p>
        ) : null}

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          {place.visit_count > 0 ? (
            <span className="text-muted-foreground inline-flex items-center gap-1">
              <Users className="h-3 w-3" aria-hidden />
              {place.visit_count} перевідвідували
            </span>
          ) : null}
          {place.accessibility_flags.length > 0 ? (
            <span className="text-accent-foreground bg-accent rounded-md px-1.5 py-0.5">
              {ACCESSIBILITY_LABELS_UK[place.accessibility_flags[0]!]}
              {place.accessibility_flags.length > 1
                ? ` +${place.accessibility_flags.length - 1}`
                : ""}
            </span>
          ) : null}
        </div>

        {place.organizer_contact ? (
          <p className="text-muted-foreground text-xs">
            <Autolink text={place.organizer_contact} />
          </p>
        ) : null}
      </div>
    </Link>
  );
}
