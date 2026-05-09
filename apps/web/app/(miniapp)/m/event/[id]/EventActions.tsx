// Sticky CTA bar for the event detail page. Two distinct states:
//
//   attending.kind === "no"
//     → Я буду / Поділитися / Не зараз
//        Tapping "Я буду" runs the combined RSVP flow (asks display
//        name on first tap, posts /opportunities/:id/rsvp, polls
//        /room until the chat is provisioned).
//
//   attending.kind === "yes"
//     → "Ти йдеш" indicator at top of bar
//     → Чат події (or "Чат готується…" while worker spins it up)
//     → Поділитися
//     → Privacy toggle (Анонімно / Показувати «name»)
//     → Маленький "Не зможу" link to decline
//
//   attending.kind === "loading"
//     → renders nothing (the page is short-lived in this state)
//
// Parent owns the `attending` state and gets notified on transitions
// (RSVP success / decline) via `onAttendingChange`.

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
import type { Attending } from "./ClientEventPage";

const ROOM_POLL_INTERVAL_MS = 4000;
const ROOM_POLL_MAX_ATTEMPTS = 30; // ≈2 minutes

export function EventActions({
  eventId,
  eventTitle,
  startedAlready,
  attending,
  onAttendingChange,
}: {
  eventId: string;
  eventTitle: string;
  /** ISO `start_at`. Read by the bar to disable RSVP after the event begins. */
  eventStartAt: string;
  startedAlready: boolean;
  attending: Attending;
  onAttendingChange: (next: Attending) => void;
}) {
  if (attending.kind === "loading") {
    // Tiny placeholder so the bottom of the page isn't a void during
    // the brief room-probe window.
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
        room={attending.room}
        onDeclined={() => onAttendingChange({ kind: "no" })}
        onRoomLanded={(room) => onAttendingChange({ kind: "yes", room })}
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
// "I'm going" state — chat link + privacy + decline
// ----------------------------------------------------------------

function AttendingBar({
  eventId,
  eventTitle,
  room,
  onDeclined,
  onRoomLanded,
}: {
  eventId: string;
  eventTitle: string;
  room: V2EventRoom | null;
  onDeclined: () => void;
  onRoomLanded: (room: V2EventRoom) => void;
}) {
  const [showName, setShowName] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<{ cancel: () => void } | null>(null);

  // If the room hasn't been provisioned yet, poll until it lands.
  useEffect(() => {
    if (room?.chat_provider) return;
    pollRef.current?.cancel();
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const fresh = await getRoom(eventId);
        if (cancelled) return;
        if (fresh && fresh.chat_provider) {
          onRoomLanded(fresh);
          return;
        }
      } catch {
        /* ignore — try again until the budget runs out */
      }
      if (attempts < ROOM_POLL_MAX_ATTEMPTS) {
        window.setTimeout(tick, ROOM_POLL_INTERVAL_MS);
      }
    };
    pollRef.current = { cancel: () => (cancelled = true) };
    window.setTimeout(tick, ROOM_POLL_INTERVAL_MS);
    return () => pollRef.current?.cancel();
  }, [eventId, room?.chat_provider, onRoomLanded]);

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
    const shareUrl = `${window.location.origin}/event/${eventId}`;
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
        <p className="text-primary text-center text-sm font-semibold">Ти йдеш</p>

        {room?.chat_invite_url ? (
          <Button asChild size="lg" className="h-12 w-full text-base font-semibold">
            <a href={room.chat_invite_url} target="_blank" rel="noopener noreferrer">
              Чат події
            </a>
          </Button>
        ) : (
          <Button
            type="button"
            size="lg"
            className="h-12 w-full text-base font-semibold"
            disabled
          >
            Чат готується…
          </Button>
        )}

        <div className="grid grid-cols-2 gap-2">
          <PrivacyChip
            active={!showName}
            onClick={() => void togglePrivacy(false)}
            label="Анонімно"
          />
          <PrivacyChip
            active={showName}
            onClick={() => void togglePrivacy(true)}
            label="Показати ім'я"
          />
        </div>

        <div className="flex items-center justify-between pt-1 text-xs">
          <button
            type="button"
            onClick={() => void onShareUrl()}
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 underline-offset-2 hover:underline"
            style={{ touchAction: "manipulation" }}
          >
            <Share2 className="h-3.5 w-3.5" aria-hidden />
            Поділитися
          </button>
          <button
            type="button"
            onClick={() => void decline()}
            disabled={busy}
            className="text-muted-foreground hover:text-destructive underline-offset-2 hover:underline disabled:opacity-50"
            style={{ touchAction: "manipulation" }}
          >
            Не зможу
          </button>
        </div>

        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </div>
    </div>
  );
}

function PrivacyChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "h-9 rounded-full border text-sm transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40",
      )}
    >
      {label}
    </button>
  );
}

// ----------------------------------------------------------------
// "Not signed up" state — RSVP CTA + name prompt sheet
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
    const shareUrl = `${window.location.origin}/event/${eventId}`;
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
            <Button type="button" variant="outline" className="h-11" onClick={() => void onShareUrl()}>
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
