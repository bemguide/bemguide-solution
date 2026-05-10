// Organizer-side controls on /m/event/[id]. Two sub-sections:
//
//   1. **Чат події** — tap "Створити / прив'язати чат" to open
//      Telegram's add-to-group picker with `?startgroup=event_<id>`.
//      User picks the group they already created, the bot joins with
//      `event_<id>` as start payload, the bot calls
//      `POST /internal/event-rooms/attach` with the right event_id +
//      the chat_id it just joined.
//
//   2. **Реєстрація учасників** — QR scanner that calls
//      `POST /opportunities/:id/check-in`. Backend authz is strict:
//      only admins or the user whose `id` matches `opportunities.
//      created_by` are accepted. Anything else → 403 'forbidden'.
//
// Visibility uses a two-layer gate:
//
//   - `isOrganizerByDb` — backend truth: `event.created_by === me.id`.
//     This is what the check-in route actually checks.
//   - `isOrganizerByHeuristic` — viewer's @TG-username matches
//     `organizer_contact`. Useful only as a fallback for legacy events
//     where `created_by` is null (a row predates migration 0013) — we
//     still show the section so the organizer has a path, but with a
//     warning that scans will likely 403 until someone backfills.

"use client";

import { useEffect, useState } from "react";
import { ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ApiError,
  describeError,
  getCurrentUser,
  logApiError,
  verifyCheckIn,
  type V2EventRoom,
  type V2User,
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
  createdBy,
  room,
}: {
  eventId: string;
  organizerContact: string | null;
  /** Backend's tracked organizer. `null` for legacy events that
   *  pre-date migration 0013 — those rows can never pass the
   *  check-in route's authz without a manual backfill. */
  createdBy: string | null;
  /** Same room data the AttendingBar uses. May be null when the
   *  organizer hasn't RSVPed (and so /room 403'd). */
  room: V2EventRoom | null;
}) {
  const [tgUsername, setTgUsername] = useState<string | null>(null);
  const [me, setMe] = useState<V2User | null>(null);
  const [result, setResult] = useState<Result>({ kind: "idle" });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [tg, currentUser] = await Promise.all([
        getTgUserWithWait(),
        getCurrentUser().catch(() => null),
      ]);
      if (cancelled) return;
      setTgUsername(tg.username ?? null);
      setMe(currentUser);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isOrganizerByDb = createdBy !== null && me !== null && createdBy === me.id;
  const isOrganizerByHeuristic = isOrganizerMatch(organizerContact, tgUsername);

  // Show the section if either signal matches. The backend will only
  // accept scans from `isOrganizerByDb`, but the heuristic still
  // catches legacy events where `created_by` is null and is the only
  // way the organizer has access until somebody backfills.
  const visible = isOrganizerByDb || isOrganizerByHeuristic;
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
      setResult({ kind: "fail", message: describeError(e, "check-in") });
    }
  }

  return (
    <section className="space-y-5 px-4 pb-4 pt-2">
      <h2 className="text-foreground text-lg font-semibold">Управління подією</h2>

      <ChatBlock createChatUrl={createChatUrl} chatInviteUrl={chatInviteUrl} />

      <ScannerBlock
        result={result}
        onScan={() => void onScan()}
      />
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
            Прив'язати групу
          </a>
        </Button>
      ) : (
        <Button type="button" size="lg" className="h-12 w-full" disabled>
          Бот не налаштований
        </Button>
      )}

      {!chatInviteUrl ? (
        <div className="text-muted-foreground space-y-1 text-xs leading-snug">
          <p>
            <strong className="text-foreground font-semibold">
              Тільки група, не канал.
            </strong>{" "}
            Telegram передасть боту, до якої події прив'язатися, тільки коли ти
            тиснеш кнопку вище — додавання бота вручну через адмінку каналу
            нічого не дасть, бо бот не знатиме, де саме він опинився.
          </p>
          <p>
            Якщо група вже існує — обери її в списку, бот переприєднається з
            правильним посиланням.
          </p>
        </div>
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
