// Organizer-side check-in section on /m/event/[id].
//
// Visible only when the viewer's Telegram @username matches the
// event's `organizer_contact` field — a heuristic until the backend
// stores `created_by_user_id` on opportunities. Not perfect (the
// field is free-text and could contain anyone's handle), but good
// enough for the demo: only the matching user sees the scan UI.
//
// On tap:
//   1. Telegram's `showScanQrPopup` opens (Bot API 6.4+).
//   2. Scanned text is the token from the attendee's QR
//      (`GET /opportunities/:id/check-in-token`).
//   3. Frontend posts it to `POST /opportunities/:id/check-in` —
//      the proposed verify endpoint (see lib/api/check-in.ts).
//   4. UI shows pass/fail with the attendee name when the backend
//      returns a user payload.
//
// Backend not yet shipped → 404 path renders a neutral
// "scanner-готовий-але-бекенд-не" hint so the surface is visible
// the moment the route lands without a frontend redeploy.

"use client";

import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  describeError,
  logApiError,
  verifyCheckIn,
} from "@/lib/api";
import { getTgUserWithWait, tgScanQr } from "@/lib/telegram/client";

type Result =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "verifying" }
  | { kind: "ok"; name: string }
  | { kind: "fail"; message: string }
  | { kind: "not-implemented" };

const TG_HANDLE_RE = /^@?([a-zA-Z][a-zA-Z0-9_]{3,31})$/;

/** Best-effort "is the contact a reference to me?" check. */
function isOrganizerMatch(contact: string | null, tgUsername: string | null): boolean {
  if (!contact || !tgUsername) return false;
  const c = contact.toLowerCase().trim();
  const u = tgUsername.toLowerCase();
  if (TG_HANDLE_RE.test(c) && c.replace(/^@/, "") === u) return true;
  // Embedded URL: "label · https://t.me/username"
  if (c.includes(`t.me/${u}`)) return true;
  return false;
}

export function OrganizerCheckIn({
  eventId,
  organizerContact,
}: {
  eventId: string;
  organizerContact: string | null;
}) {
  const [tgUsername, setTgUsername] = useState<string | null>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const tg = await getTgUserWithWait();
      if (!cancelled) setTgUsername(tg.username ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visible = isOrganizerMatch(organizerContact, tgUsername);
  if (!visible) return null;

  async function onScan() {
    setResult({ kind: "scanning" });
    const token = await tgScanQr("Скануй QR учасника");
    if (!token) {
      setResult({ kind: "idle" });
      return;
    }
    setResult({ kind: "verifying" });
    try {
      const r = await verifyCheckIn(eventId, token);
      const name = r.user?.display_name?.trim() || "Учасник";
      setResult({ kind: "ok", name });
    } catch (e) {
      logApiError("check-in.verify", e);
      if (e instanceof ApiError && e.status === 404) {
        setResult({ kind: "not-implemented" });
        return;
      }
      setResult({ kind: "fail", message: describeError(e) });
    }
  }

  return (
    <section className="space-y-2 px-4 pb-4 pt-2">
      <h2 className="text-foreground text-lg font-semibold">Реєстрація учасників</h2>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 w-full"
        onClick={() => void onScan()}
        disabled={result.kind === "scanning" || result.kind === "verifying"}
      >
        <ScanLine className="mr-2 h-5 w-5" aria-hidden />
        {result.kind === "scanning"
          ? "Сканую…"
          : result.kind === "verifying"
            ? "Перевіряю…"
            : "Сканувати QR"}
      </Button>

      <ResultLine result={result} />
    </section>
  );
}

function ResultLine({ result }: { result: Result }) {
  if (result.kind === "idle" || result.kind === "scanning" || result.kind === "verifying") {
    return null;
  }
  if (result.kind === "ok") {
    return (
      <p className="text-primary bg-accent rounded-md px-3 py-2 text-sm">
        ✓ {result.name} — записано як присутнього.
      </p>
    );
  }
  if (result.kind === "not-implemented") {
    return (
      <p className="text-muted-foreground bg-muted rounded-md px-3 py-2 text-sm">
        Бекенд поки що не приймає check-in. QR прочитано, перевірка зʼявиться,
        коли вийде ендпоінт.
      </p>
    );
  }
  return (
    <p className="text-destructive bg-destructive/10 rounded-md px-3 py-2 text-sm">
      {result.message}
    </p>
  );
}
