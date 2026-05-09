// Sticky CTA bar + RSVP confirm sheet for the miniapp event page.
// Talks to the v2 backend's combined RSVP endpoint:
//   POST /opportunities/:id/rsvp { response, display_name?, show_name_publicly? }
// On accept the room is provisioned async by the backend's worker — we
// poll GET /opportunities/:id/room until chat_provider is non-null and
// surface the join link when it lands.

"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, Calendar, MapPin, MessageCircle, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getTgUser } from "@/lib/telegram/client";
import { formatEventDateTime } from "@/lib/format";
import {
  ApiError,
  getRoom,
  rsvp,
  setShowNamePublicly,
  type V2EventRoom,
} from "@/lib/api";

type Confirmed = {
  attendeeShown: boolean;
  room: V2EventRoom | null;
};

const ROOM_POLL_INTERVAL_MS = 4000;
const ROOM_POLL_MAX_ATTEMPTS = 30; // ≈2 minutes of polling

export function EventActions({
  eventId,
  eventTitle,
  eventStartAt,
  startedAlready,
}: {
  eventId: string;
  eventTitle: string;
  eventStartAt: string;
  startedAlready: boolean;
}) {
  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null);
  const [showName, setShowName] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<{ cancel: () => void } | null>(null);

  useEffect(() => {
    setName(getTgUser().firstName ?? "");
  }, []);

  // Stop any active room poll on unmount.
  useEffect(() => {
    return () => pollRef.current?.cancel();
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
      setConfirmed({ attendeeShown: false, room: res.room });
      setNeedsName(false);
      // If the backend hasn't materialised the room yet, poll for it.
      if (!res.room || !res.room.chat_provider) {
        startRoomPoll();
      }
    } catch (e) {
      setError(rsvpErrorToMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function deferRsvp() {
    setBusy(true);
    setError(null);
    try {
      // The combined RSVP endpoint doesn't have a "defer" action; the
      // closest semantic is dismissing without responding. Just close the
      // sheet — the invitation row stays in `delivery_status='sent'` and
      // the caller can come back later.
      setError(null);
      alert("Окей, нагадаю напередодні.");
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

  function onPrimaryClick() {
    if (startedAlready) return;
    if (!name) {
      setNeedsName(true);
      return;
    }
    void confirmRsvp(name.trim());
  }

  async function toggleShowName(next: boolean) {
    setShowName(next);
    if (!confirmed) return;
    try {
      await setShowNamePublicly(eventId, next);
    } catch (e) {
      console.warn("show-name update failed:", e);
    }
  }

  function startRoomPoll() {
    pollRef.current?.cancel();
    let cancelled = false;
    let attempts = 0;
    const tick = async () => {
      if (cancelled) return;
      attempts++;
      try {
        const room = await getRoom(eventId);
        if (cancelled) return;
        if (room && room.chat_provider) {
          setConfirmed((c) => (c ? { ...c, room } : c));
          return;
        }
      } catch (e) {
        if (process.env.NODE_ENV !== "production") {
          console.debug("[room-poll]", e);
        }
      }
      if (attempts < ROOM_POLL_MAX_ATTEMPTS) {
        window.setTimeout(tick, ROOM_POLL_INTERVAL_MS);
      }
    };
    pollRef.current = { cancel: () => (cancelled = true) };
    window.setTimeout(tick, ROOM_POLL_INTERVAL_MS);
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
            <Button type="button" variant="outline" className="h-11" onClick={onShareUrl}>
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

      {/* Inline display_name prompt (one-shot) */}
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

      {/* Confirm sheet */}
      <Sheet open={!!confirmed} onOpenChange={(o) => !o && setConfirmed(null)}>
        <SheetContent side="bottom" className="space-y-4 px-5 pb-10 pt-6">
          <div className="bg-primary/10 mx-auto flex h-12 w-12 items-center justify-center rounded-full">
            <Calendar className="text-primary h-6 w-6" aria-hidden />
          </div>
          <SheetTitle className="text-center">Записав.</SheetTitle>
          <p className="text-muted-foreground text-center text-sm">
            {formatEventDateTime(eventStartAt)} — «{eventTitle}». Нагадаю напередодні і за 10
            хвилин.
          </p>
          {confirmed ? (
            <div className="space-y-2">
              {confirmed.room?.chat_invite_url ? (
                <Button asChild size="lg" className="h-12 w-full justify-start">
                  <a
                    href={confirmed.room.chat_invite_url}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                    Чат події
                  </a>
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  className="border-primary/30 text-muted-foreground h-12 w-full justify-start"
                  disabled
                >
                  <MessageCircle className="mr-2 h-4 w-4" aria-hidden />
                  Чат готується…
                </Button>
              )}
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-primary/30 text-primary h-12 w-full justify-start"
              >
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(eventTitle)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MapPin className="mr-2 h-4 w-4" aria-hidden />
                  Як дістатися
                </a>
              </Button>
            </div>
          ) : null}
          <div className="border-border flex items-start gap-3 rounded-lg border p-3">
            <Switch
              id="show-name"
              checked={showName}
              onCheckedChange={(v) => void toggleShowName(v)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="show-name" className="text-sm font-medium">
                Показувати моє ім'я іншим ветеранам у цій події
              </Label>
              <p className="text-muted-foreground text-xs">
                Залишишся анонімним. Видно тільки кількість.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setConfirmed(null)}
            className="text-muted-foreground w-full text-center text-sm underline-offset-2 hover:underline"
          >
            Готово
          </button>
        </SheetContent>
      </Sheet>
    </>
  );
}

function rsvpErrorToMessage(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.message === "no_telegram_environment")
      return "Відкрий додаток у Telegram, щоб записатися.";
    if (e.message === "event_started") return "Подія вже почалася.";
    if (e.message === "already_rsvped") return "Ти вже відповів на цю подію.";
    if (e.status === 401) return "Сесія завершилась — закрий і відкрий додаток.";
    if (e.status >= 500) return "Сервер тимчасово не відповідає. Спробуй ще раз.";
  }
  return "Не вдалось записати. Спробуй ще раз.";
}
