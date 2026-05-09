// QR-code sheet shown when an attending user taps "Показати QR".
// The organizer (or whoever runs the event) scans it to confirm
// attendance.
//
// Token source order:
//   1. Backend's `GET /opportunities/:id/check-in-token` — signed,
//      verifiable by the organizer's scanner.
//   2. Client-side fallback `evt:<eventId>|usr:<userId>` — used while
//      the backend endpoint is still in flight so the demo flow
//      doesn't break. Marked visually so the user (and organizer)
//      know this is a placeholder.
//
// The QR itself is rendered by api.qrserver.com so we don't ship a
// client-side QR library. ~150B per request, identical URL is
// cacheable.

"use client";

import { useEffect, useState } from "react";
import { ApiError, getCheckInToken, getCurrentUser, logApiError } from "@/lib/api";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";

const QR_BASE = "https://api.qrserver.com/v1/create-qr-code/";

function buildQrSrc(payload: string, sizePx = 360): string {
  const params = new URLSearchParams({
    size: `${sizePx}x${sizePx}`,
    data: payload,
    margin: "8",
    qzone: "1",
  });
  return `${QR_BASE}?${params.toString()}`;
}

type Source =
  | { kind: "loading" }
  | { kind: "backend"; token: string; expires_at?: string }
  | { kind: "fallback"; token: string }
  | { kind: "error"; message: string };

export function QrSheet({
  open,
  onOpenChange,
  eventId,
  eventTitle,
  startedAlreadyLine,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  eventId: string;
  eventTitle: string;
  /** Pre-formatted "{date} · {city}" line used as the sheet's subtitle. */
  startedAlreadyLine: string;
}) {
  const [source, setSource] = useState<Source>({ kind: "loading" });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setSource({ kind: "loading" });

    async function load() {
      try {
        const t = await getCheckInToken(eventId);
        if (cancelled) return;
        setSource({ kind: "backend", token: t.token, expires_at: t.expires_at });
      } catch (e) {
        if (cancelled) return;
        // 404 = backend hasn't implemented the endpoint yet → fall back
        // to the client-side payload so the user still sees a QR.
        if (e instanceof ApiError && e.status === 404) {
          try {
            const me = await getCurrentUser();
            if (cancelled) return;
            setSource({
              kind: "fallback",
              token: `evt:${eventId}|usr:${me.id}`,
            });
          } catch (e2) {
            if (cancelled) return;
            logApiError("qr.fallback", e2);
            setSource({ kind: "error", message: "Не вдалось згенерувати QR." });
          }
          return;
        }
        logApiError("qr.token", e);
        setSource({ kind: "error", message: "Не вдалось отримати QR." });
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [open, eventId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="space-y-4 px-5 pb-8 pt-6">
        <SheetTitle className="text-center">Покажи QR організатору</SheetTitle>
        <p className="text-muted-foreground text-center text-sm">
          {eventTitle}
        </p>
        <p className="text-muted-foreground text-center text-xs">{startedAlreadyLine}</p>

        <div className="bg-card border-border mx-auto flex aspect-square w-full max-w-[280px] items-center justify-center rounded-2xl border p-3">
          {source.kind === "loading" ? (
            <div className="bg-muted h-full w-full animate-pulse rounded-xl" />
          ) : source.kind === "error" ? (
            <p className="text-destructive max-w-xs text-center text-sm">{source.message}</p>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={buildQrSrc(source.token)}
              alt="QR-код для перевірки участі"
              className="h-full w-full object-contain"
            />
          )}
        </div>

        {source.kind === "fallback" ? (
          <p className="text-muted-foreground mx-auto max-w-xs text-center text-xs">
            Це попередній QR. Підпис організатора буде доданий, коли бекенд видає токен.
          </p>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="h-12 w-full"
          onClick={() => onOpenChange(false)}
        >
          Закрити
        </Button>
      </SheetContent>
    </Sheet>
  );
}
