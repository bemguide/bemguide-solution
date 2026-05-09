// Sticky CTA bar for the event detail page. Four render branches
// driven by the parent's `attending` state:
//
//   "loading"  → tiny skeleton (room probe in flight)
//   "no"       → RSVP CTA + name-prompt sheet
//   "yes"      → chat link + share + decline + privacy toggle
//   "declined" → "ти не йдеш" + organizer-contact link
//                (backend's sticky-decline policy means the user
//                 can't re-accept through the API; the only way
//                 back in is to talk to the organizer).
//
// Parent owns the state and is notified on transitions via
// `onAttendingChange`.

"use client";

import { useEffect, useState } from "react";
import { Bell, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTgUser } from "@/lib/telegram/client";
import { cn } from "@/lib/utils";
import {
  ApiError,
  describeError,
  logApiError,
  rsvp,
  setShowNamePublicly,
  type V2EventRoom,
} from "@/lib/api";
import { buildEventShareUrl } from "@/lib/share";
import { extractFirstUrl } from "@/lib/url";
import { QrSheet } from "@/components/poruch/QrSheet";
import { formatEventDateTime } from "@/lib/format";
import type { Attending } from "./ClientEventPage";

export function EventActions({
  eventId,
  eventTitle,
  eventStartAt,
  startedAlready,
  organizerContact,
  attending,
  onAttendingChange,
  city,
}: {
  eventId: string;
  eventTitle: string;
  /** ISO `start_at`. Read by the bar to disable RSVP after the event begins. */
  eventStartAt: string;
  startedAlready: boolean;
  organizerContact: string | null;
  city: string | null;
  attending: Attending;
  onAttendingChange: (next: Attending) => void;
}) {
  if (attending.kind === "loading") {
    return (
      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
        <div className="bg-muted h-12 w-full animate-pulse rounded-md" />
      </div>
    );
  }
  if (attending.kind === "yes") {
    return (
      <AttendingBar
        eventId={eventId}
        eventTitle={eventTitle}
        eventStartAt={eventStartAt}
        city={city}
        onDeclined={() => onAttendingChange({ kind: "declined" })}
      />
    );
  }
  if (attending.kind === "declined") {
    return (
      <DeclinedBar
        eventId={eventId}
        eventTitle={eventTitle}
        organizerContact={organizerContact}
      />
    );
  }
  return (
    <RsvpBar
      eventId={eventId}
      eventTitle={eventTitle}
      startedAlready={startedAlready}
      onAccepted={(room) => onAttendingChange({ kind: "yes", room })}
      onAlreadyDeclined={() => onAttendingChange({ kind: "declined" })}
    />
  );
}

// ----------------------------------------------------------------
// "I'm going" — QR check-in + share + decline + privacy
// ----------------------------------------------------------------

function AttendingBar({
  eventId,
  eventTitle,
  eventStartAt,
  city,
  onDeclined,
}: {
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  city: string | null;
  onDeclined: () => void;
}) {
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);

  async function togglePrivacy(next: boolean) {
    setShowName(next);
    try {
      await setShowNamePublicly(eventId, next);
    } catch (e) {
      logApiError("attendee.show-name", e);
      setShowName(!next);
    }
  }

  async function decline() {
    if (busy) return;
    if (typeof window !== "undefined" && !window.confirm("Скасувати участь?")) return;
    setBusy(true);
    setError(null);
    try {
      await rsvp(eventId, { response: "declined" });
      onDeclined();
    } catch (e) {
      logApiError("rsvp.decline", e);
      setError(describeError(e, "rsvp"));
    } finally {
      setBusy(false);
    }
  }

  async function onShareUrl() {
    const shareUrl = buildEventShareUrl(eventId);
    if (navigator.share) {
      try {
        await navigator.share({ title: eventTitle, url: shareUrl });
        return;
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      window.open(shareUrl, "_blank", "noopener");
    }
  }

  const subtitle = [eventStartAt ? formatEventDateTime(eventStartAt) : null, city]
    .filter(Boolean)
    .join(" · ");

  return (
    <>
      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            className="h-12 w-full text-base font-semibold"
            onClick={() => setQrOpen(true)}
          >
            Показати QR
          </Button>

          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => void onShareUrl()}
            >
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
              Поділитися
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => void decline()}
              disabled={busy}
            >
              Не зможу
            </Button>
          </div>

          <button
            type="button"
            onClick={() => void togglePrivacy(!showName)}
            className={cn(
              "block w-full text-center text-xs underline-offset-2 hover:underline",
              showName ? "text-primary" : "text-muted-foreground hover:text-foreground",
            )}
            style={{ touchAction: "manipulation" }}
            aria-pressed={showName}
          >
            {showName
              ? "Показую ім'я · натисни щоб приховати"
              : "Анонімно · натисни щоб показати ім'я"}
          </button>

          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>
      </div>

      <QrSheet
        open={qrOpen}
        onOpenChange={setQrOpen}
        eventId={eventId}
        eventTitle={eventTitle}
        startedAlreadyLine={subtitle}
      />
    </>
  );
}

// ----------------------------------------------------------------
// "Already declined" — sticky on the backend, contact-organizer path
// ----------------------------------------------------------------

function DeclinedBar({
  eventId,
  eventTitle,
  organizerContact,
}: {
  eventId: string;
  eventTitle: string;
  organizerContact: string | null;
}) {
  const contactHref = buildOrganizerHref(organizerContact);

  async function onShareUrl() {
    const shareUrl = buildEventShareUrl(eventId);
    if (navigator.share) {
      try {
        await navigator.share({ title: eventTitle, url: shareUrl });
        return;
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      window.open(shareUrl, "_blank", "noopener");
    }
  }

  return (
    <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
      <div className="space-y-2">
        <p className="text-muted-foreground text-center text-sm">
          Ти раніше відмовився. Передумав? Напиши організатору.
        </p>
        {contactHref ? (
          <Button asChild size="lg" className="h-12 w-full text-base font-semibold">
            <a href={contactHref} target="_blank" rel="noopener noreferrer">
              Написати організатору
            </a>
          </Button>
        ) : (
          <Button type="button" size="lg" className="h-12 w-full text-base font-semibold" disabled>
            Контакт організатора недоступний
          </Button>
        )}
        <Button type="button" variant="outline" className="h-11 w-full" onClick={() => void onShareUrl()}>
          <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
          Поділитися
        </Button>
      </div>
    </div>
  );
}

/**
 * Best-effort contact → URL conversion. Backend stores
 * `organizer_contact` as free text — could be a Telegram handle, a
 * URL, an email, a phone, or arbitrary instructions. We sniff the
 * shape and build the right scheme; bail out (return null) if we
 * can't tell.
 */
function buildOrganizerHref(raw: string | null): string | null {
  if (!raw) return null;
  const c = raw.trim();
  if (!c) return null;
  // Extract any embedded URL first — handles the common
  // "label · https://www.facebook.com/very/long" shape.
  const embedded = extractFirstUrl(c);
  if (embedded) return embedded;
  if (c.startsWith("@")) return `https://t.me/${c.slice(1)}`;
  if (/^t\.me\//i.test(c)) return `https://${c}`;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c)) return `mailto:${c}`;
  if (/^\+?[\d\s\-()]{6,}$/.test(c)) return `tel:${c.replace(/\s/g, "")}`;
  // Free-form text / instructions — no actionable href.
  return null;
}

// ----------------------------------------------------------------
// "Not signed up" — RSVP CTA + name prompt sheet
// ----------------------------------------------------------------

function RsvpBar({
  eventId,
  eventTitle,
  startedAlready,
  onAccepted,
  onAlreadyDeclined,
}: {
  eventId: string;
  eventTitle: string;
  startedAlready: boolean;
  onAccepted: (room: V2EventRoom | null) => void;
  /** Backend rejected the accept with `409 already_rsvped` — tells
   *  the parent to render the "you already declined" branch. */
  onAlreadyDeclined: () => void;
}) {
  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(getTgUser().firstName ?? "");
  }, []);

  async function confirmRsvp(displayName: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await rsvp(eventId, {
        response: "accepted",
        display_name: displayName,
        show_name_publicly: false,
      });
      setNeedsName(false);
      onAccepted(res.room ?? null);
    } catch (e) {
      logApiError("rsvp", e);
      // Sticky-decline path — flip to the dedicated "you already
      // declined" UI so the user can act on it instead of seeing a
      // raw error.
      if (e instanceof ApiError && e.status === 409 && e.message === "already_rsvped") {
        setNeedsName(false);
        onAlreadyDeclined();
        return;
      }
      setError(describeError(e, "rsvp"));
    } finally {
      setBusy(false);
    }
  }

  function deferRsvp() {
    if (typeof window !== "undefined") {
      window.alert("Окей, нагадаю напередодні.");
    }
  }

  async function onShareUrl() {
    const shareUrl = buildEventShareUrl(eventId);
    if (navigator.share) {
      try {
        await navigator.share({ title: eventTitle, url: shareUrl });
        return;
      } catch {
        /* user cancelled */
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
    } catch {
      window.open(shareUrl, "_blank", "noopener");
    }
  }

  function onPrimaryClick() {
    if (startedAlready) return;
    if (!name) {
      setNeedsName(true);
      return;
    }
    void confirmRsvp(name.trim());
  }

  return (
    <>
      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
        <div className="space-y-2">
          <Button
            type="button"
            size="lg"
            className="h-14 w-full text-base font-semibold"
            onClick={onPrimaryClick}
            disabled={busy || startedAlready}
          >
            {startedAlready ? "Уже почалося" : "Я буду"}
          </Button>
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={() => void onShareUrl()}
            >
              <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
              Поділитися
            </Button>
            <Button
              type="button"
              variant="outline"
              className="h-11"
              onClick={deferRsvp}
              disabled={busy || startedAlready}
            >
              <Bell className="mr-1.5 h-4 w-4" aria-hidden />
              Не зараз
            </Button>
          </div>
          {error ? <p className="text-destructive text-xs">{error}</p> : null}
        </div>
      </div>

      <Sheet open={needsName} onOpenChange={setNeedsName}>
        <SheetContent side="bottom" className="space-y-3 px-5 pb-8 pt-6">
          <SheetTitle>Як до тебе звертатися?</SheetTitle>
          <p className="text-muted-foreground text-sm">
            Тільки ім'я. Інші ветерани побачать це тільки якщо ти увімкнеш «показувати моє ім'я».
          </p>
          <div className="space-y-2">
            <Label htmlFor="dn">Ім'я</Label>
            <Input id="dn" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <Button
            type="button"
            size="lg"
            className="h-12 w-full"
            onClick={() => name.trim() && void confirmRsvp(name.trim())}
            disabled={busy || !name.trim()}
          >
            Записати
          </Button>
        </SheetContent>
      </Sheet>
    </>
  );
}
