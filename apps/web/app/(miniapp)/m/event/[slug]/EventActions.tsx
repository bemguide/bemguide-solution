// Sticky CTA bar + RSVP confirm modal for the miniapp event page.
// Tap "Я буду" → if the veteran has no display_name yet, ask inline once;
// then POST /api/rsvp/create and open the confirm sheet with calendar/QR/maps.

"use client";

import { useEffect, useState } from "react";
import { Bell, Calendar, MapPin, QrCode, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { fetchWithInitData, getTgUser } from "@/lib/telegram/client";
import { formatEventDateTime } from "@/lib/format";

type RsvpResp = {
  ok: boolean;
  rsvp_id?: string;
  qr_token?: string;
  status?: string;
  error?: string;
};

export function EventActions({
  eventId,
  eventSlug,
  eventTitle,
  eventStartAt,
}: {
  eventId: string;
  eventSlug: string;
  eventTitle: string;
  eventStartAt: string;
}) {
  const [needsName, setNeedsName] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmed, setConfirmed] = useState<{
    rsvpId: string;
    qrToken: string;
  } | null>(null);
  const [showName, setShowName] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(getTgUser().firstName ?? "");
  }, []);

  async function confirmRsvp(displayName?: string) {
    setBusy(true);
    setError(null);
    try {
      const { status, json } = await fetchWithInitData<RsvpResp>("/api/rsvp/create", {
        method: "POST",
        body: JSON.stringify({
          event_id: eventId,
          ...(displayName ? { display_name: displayName } : {}),
        }),
      });
      if (status !== 200 || !json?.ok || !json.rsvp_id || !json.qr_token) {
        setError(json?.error ?? "Не вдалось записати. Спробуй ще раз.");
        return;
      }
      setConfirmed({ rsvpId: json.rsvp_id, qrToken: json.qr_token });
      setNeedsName(false);
    } finally {
      setBusy(false);
    }
  }

  async function deferRsvp() {
    setBusy(true);
    setError(null);
    try {
      const { status, json } = await fetchWithInitData<RsvpResp>("/api/rsvp/create", {
        method: "POST",
        body: JSON.stringify({ event_id: eventId, defer: true }),
      });
      if (status !== 200 || !json?.ok) {
        setError(json?.error ?? "Не вдалось зберегти.");
        return;
      }
      setError(null);
      // Show a toast-like message using the same modal sheet.
      setConfirmed(null);
      alert("Окей, нагадаю через тиждень.");
    } finally {
      setBusy(false);
    }
  }

  async function onShareUrl() {
    const shareUrl = `${window.location.origin}/event/${eventSlug}`;
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
    if (!name) {
      setNeedsName(true);
      return;
    }
    confirmRsvp(name.trim());
  }

  async function toggleShowName(next: boolean) {
    setShowName(next);
    // Per-event override on the rsvps row.
    if (!confirmed) return;
    await fetchWithInitData("/api/rsvp/show-name", {
      method: "POST",
      body: JSON.stringify({ rsvp_id: confirmed.rsvpId, show: next }),
    });
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
            disabled={busy}
          >
            Я буду
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
              disabled={busy}
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
            onClick={() => name.trim() && confirmRsvp(name.trim())}
            disabled={busy || !name.trim()}
          >
            Записати
          </Button>
        </SheetContent>
      </Sheet>

      {/* Confirm sheet with calendar / QR / maps */}
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
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-primary/30 text-primary h-12 w-full justify-start"
              >
                <a
                  href={icsUrl(confirmed.rsvpId, confirmed.qrToken)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <Calendar className="mr-2 h-4 w-4" aria-hidden />
                  Додати в календар
                </a>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-primary/30 text-primary h-12 w-full justify-start"
              >
                <a
                  href={qrUrl(confirmed.rsvpId, confirmed.qrToken)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <QrCode className="mr-2 h-4 w-4" aria-hidden />
                  Мій QR
                </a>
              </Button>
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

function icsUrl(rsvpId: string, qrToken: string): string {
  const base =
    process.env.NEXT_PUBLIC_SUPABASE_FN_URL ??
    (typeof window !== "undefined"
      ? `${window.location.protocol}//${window.location.host.replace(/^/, "")}`
      : "");
  // Construct against the Supabase functions origin from a runtime hint baked at build.
  const fnRoot =
    process.env.NEXT_PUBLIC_FUNCTIONS_BASE ??
    "https://rwpzgsooevcmfcjaiqsy.supabase.co/functions/v1";
  void base;
  return `${fnRoot}/ics-generate?rsvp_id=${encodeURIComponent(rsvpId)}&token=${encodeURIComponent(qrToken)}`;
}

function qrUrl(rsvpId: string, qrToken: string): string {
  // Inline QR via the public api.qrserver.com generator. The QR encodes the
  // rsvp's check-in URL, scoped to the org.
  const target = `https://t.me/?start=rsvp_${rsvpId}_${qrToken}`;
  return `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(target)}`;
}
