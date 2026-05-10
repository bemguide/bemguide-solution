// Sticky CTA bar for the event detail page. Three render branches
// driven by the parent's `attending` state:
//
//   "loading" → tiny placeholder while /room probe is in flight.
//   "no"      → RSVP CTA + name-prompt sheet.
//   "yes"     → QR check-in + chat-link (when bot has attached a
//               room) + share + decline + privacy toggle.
//
// Backend dropped sticky-decline (`fix(rsvp): allow re-subscribing
// after decline`), so we no longer carry a separate "declined"
// branch — re-tapping "Я буду" just works.

"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getTgUser } from "@/lib/telegram/client";
import { cn } from "@/lib/utils";
import {
  describeError,
  getRoom,
  logApiError,
  rsvp,
  setShowNamePublicly,
  type V2EventRoom,
} from "@/lib/api";
import { buildEventShareUrl } from "@/lib/share";
import { QrSheet } from "@/components/poruch/QrSheet";
import { formatEventDateTime } from "@/lib/format";
import type { Attending } from "./ClientEventPage";

const ROOM_POLL_INTERVAL_MS = 4000;
const ROOM_POLL_MAX_ATTEMPTS = 30; // ≈2 minutes

export function EventActions({
  eventId,
  eventTitle,
  eventStartAt,
  startedAlready,
  attending,
  onAttendingChange,
  city,
}: {
  eventId: string;
  eventTitle: string;
  /** ISO `start_at`. Read by the bar to disable RSVP after the event begins. */
  eventStartAt: string;
  startedAlready: boolean;
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
        room={attending.room}
        onRoomLanded={(room) => onAttendingChange({ kind: "yes", room })}
        onDeclined={() => onAttendingChange({ kind: "no" })}
      />
    );
  }
  return (
    <RsvpBar
      eventId={eventId}
      eventTitle={eventTitle}
      startedAlready={startedAlready}
      onAccepted={(room) => onAttendingChange({ kind: "yes", room })}
    />
  );
}

// ----------------------------------------------------------------
// "I'm going" — QR check-in + chat link + share + decline + privacy
// ----------------------------------------------------------------

function AttendingBar({
  eventId,
  eventTitle,
  eventStartAt,
  city,
  room,
  onRoomLanded,
  onDeclined,
}: {
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  city: string | null;
  room: V2EventRoom | null;
  onRoomLanded: (room: V2EventRoom) => void;
  onDeclined: () => void;
}) {
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const pollRef = useRef<{ cancel: () => void } | null>(null);

  // If the bot hasn't attached a chat yet, poll until it lands so
  // the "Чат події" button appears without a manual reload.
  useEffect(() => {
    if (room?.chat_invite_url) return;
    pollRef.current?.cancel();
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const fresh = await getRoom(eventId);
        if (cancelled) return;
        if (fresh?.chat_invite_url) {
          onRoomLanded(fresh);
          return;
        }
      } catch {
        /* try again until the budget runs out */
      }
      if (attempts < ROOM_POLL_MAX_ATTEMPTS) {
        window.setTimeout(tick, ROOM_POLL_INTERVAL_MS);
      }
    };
    pollRef.current = { cancel: () => (cancelled = true) };
    window.setTimeout(tick, ROOM_POLL_INTERVAL_MS);
    return () => pollRef.current?.cancel();
  }, [eventId, room?.chat_invite_url, onRoomLanded]);

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

          {room?.chat_invite_url ? (
            <Button
              asChild
              variant="outline"
              size="lg"
              className="h-11 w-full text-sm font-semibold"
            >
              <a href={room.chat_invite_url} target="_blank" rel="noopener noreferrer">
                Чат події
              </a>
            </Button>
          ) : (
            <p className="text-muted-foreground px-1 text-center text-xs leading-snug">
              Чат з'явиться, коли організатор створить групу та додасть нашого бота.
            </p>
          )}

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
// "Not signed up" — RSVP CTA + name prompt sheet
// ----------------------------------------------------------------

function RsvpBar({
  eventId,
  eventTitle,
  startedAlready,
  onAccepted,
}: {
  eventId: string;
  eventTitle: string;
  startedAlready: boolean;
  onAccepted: (room: V2EventRoom | null) => void;
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
