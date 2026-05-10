// Organizer-side controls on /m/event/[id]. Two sub-sections:
//
//   1. **Чат події** — tap "Створити / прив'язати чат" to open
//      Telegram's add-to-group picker with `?startgroup=evt_<id>`.
//      User picks the group they already created, the bot joins with
//      `evt_<id>` as start payload, the bot calls
//      `POST /internal/event-rooms/attach` with the right event_id +
//      the chat_id it just joined.
//
//      Without this hand-off the bot has no way to know which event
//      a freshly-joined chat is for, so nothing was happening when
//      organizers manually added the bot — the start payload is the
//      missing breadcrumb.
//
//      The chat-already-exists case shows "Відкрити чат" pulling
//      `room.chat_invite_url` (same source as AttendingBar) so the
//      organizer doesn't need to RSVP into their own event just to
//      reach the chat. `null` when chat isn't bound yet — Telegram
//      will route the picker to wherever the user already added the
//      bot so re-running the action is idempotent.
//
//   2. **Реєстрація учасників** — QR scanner unchanged.
//
// Whole section is gated on a heuristic (viewer's @username matches
// `organizer_contact`). Replace with a backend-tracked
// `created_by_user_id` check when that lands.

"use client";

import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  describeError,
  logApiError,
  verifyCheckIn,
  type V2EventRoom,
} from "@/lib/api";
import { buildCreateChatUrl } from "@/lib/share";
import { getTgUserWithWait, tgScanQr } from "@/lib/telegram/client";

type Result =
  | { kind: "idle" }
  | { kind: "scanning" }
  | { kind: "verifying" }
  | { kind: "ok"; name: string }
  | { kind: "fail"; message: string }
  | { kind: "not-implemented" };

const TG_HANDLE_RE = /^@?([a-zA-Z][a-zA-Z0-9_]{3,31})$/;

function isOrganizerMatch(contact: string | null, tgUsername: string | null): boolean {
  if (!contact || !tgUsername) return false;
  const c = contact.toLowerCase().trim();
  const u = tgUsername.toLowerCase();
  if (TG_HANDLE_RE.test(c) && c.replace(/^@/, "") === u) return true;
  if (c.includes(`t.me/${u}`)) return true;
  return false;
}

export function OrganizerCheckIn({
  eventId,
  organizerContact,
  room,
}: {
  eventId: string;
  organizerContact: string | null;
  /** Same room data the AttendingBar uses. May be null when the
   *  organizer hasn't RSVPed (and so /room 403'd). */
  room: V2EventRoom | null;
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

  const createChatUrl = buildCreateChatUrl(eventId);
  const chatInviteUrl = room?.chat_invite_url ?? null;

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
    <section className="space-y-5 px-4 pb-4 pt-2">
      <h2 className="text-foreground text-lg font-semibold">Управління подією</h2>

      <ChatBlock createChatUrl={createChatUrl} chatInviteUrl={chatInviteUrl} />

      <ScannerBlock result={result} onScan={() => void onScan()} />
    </section>
  );
}

function ChatBlock({
  createChatUrl,
  chatInviteUrl,
}: {
  createChatUrl: string | null;
  chatInviteUrl: string | null;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        Чат події
      </p>

      {chatInviteUrl ? (
        <Button asChild size="lg" className="h-12 w-full">
          <a href={chatInviteUrl} target="_blank" rel="noopener noreferrer">
            Відкрити чат
          </a>
        </Button>
      ) : createChatUrl ? (
        <Button asChild variant="outline" size="lg" className="h-12 w-full">
          <a href={createChatUrl} target="_blank" rel="noopener noreferrer">
            Створити / прив'язати чат
          </a>
        </Button>
      ) : (
        <Button type="button" size="lg" className="h-12 w-full" disabled>
          Бот не налаштований
        </Button>
      )}

      {!chatInviteUrl ? (
        <p className="text-muted-foreground text-xs leading-snug">
          Telegram запропонує обрати групу. Бот приєднається і привʼяже її до
          цієї події. Якщо група вже існує — обери її, бот сам розбереться.
        </p>
      ) : null}
    </div>
  );
}

function ScannerBlock({
  result,
  onScan,
}: {
  result: Result;
  onScan: () => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wider">
        Реєстрація учасників
      </p>

      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-12 w-full"
        onClick={onScan}
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
    </div>
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
