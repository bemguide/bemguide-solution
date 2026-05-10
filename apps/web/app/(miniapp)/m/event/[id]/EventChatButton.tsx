// Group-chat affordance for the event detail page. Two render branches
// driven by the parent's `room` state:
//
//   no chat yet → "Створити чат" → opens the bot's startgroup deep-link in
//                  Telegram. After tap, polls GET /opportunities/:id/room
//                  every 5s for ~60s; flips to the "open" branch as soon
//                  as the bot has reported the chat back to the backend.
//   chat exists → "Чат події" → opens the invite URL via openTelegramLink
//                  so it lands inside Telegram (group-join prompt) and not
//                  in the browser.
//
// Hidden entirely when NEXT_PUBLIC_TG_BOT_USERNAME isn't configured —
// the deep-link wouldn't resolve anyway, and surfacing a button that
// silently does nothing is worse than not rendering at all.

"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getRoom, type V2EventRoom } from "@/lib/api";

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 60_000;

const BOT_USERNAME = process.env.NEXT_PUBLIC_TG_BOT_USERNAME;

interface TelegramWebApp {
  openTelegramLink?: (url: string) => void;
}

function openTgLink(url: string): void {
  const wa = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  if (wa?.openTelegramLink) {
    wa.openTelegramLink(url);
  } else {
    // Outside Telegram (dev/preview/regular browser) — fall back so the
    // flow is still testable.
    window.open(url, "_blank", "noopener");
  }
}

export function EventChatButton({
  eventId,
  initialRoom,
  onRoomChange,
}: {
  eventId: string;
  initialRoom: V2EventRoom | null;
  /** Called when polling detects the bot has attached the chat. Lets the
   *  parent update its `attending.room` so the rest of the page reflects
   *  the new state on the same render. */
  onRoomChange?: (room: V2EventRoom) => void;
}) {
  const [room, setRoom] = useState<V2EventRoom | null>(initialRoom);
  const [pending, setPending] = useState(false);
  const pollerRef = useRef<number | null>(null);

  // Sync with parent — if parent re-fetches and passes a fresh room, adopt it.
  useEffect(() => setRoom(initialRoom), [initialRoom]);

  // Tear down any in-flight poll on unmount.
  useEffect(() => {
    return () => {
      if (pollerRef.current !== null) {
        window.clearInterval(pollerRef.current);
        pollerRef.current = null;
      }
    };
  }, []);

  if (!BOT_USERNAME) return null;

  const inviteUrl = room?.chat_invite_url ?? null;

  function startCreate() {
    const link = `https://t.me/${BOT_USERNAME}?startgroup=event_${eventId}`;
    openTgLink(link);
    setPending(true);

    if (pollerRef.current !== null) window.clearInterval(pollerRef.current);
    const startedAt = Date.now();
    pollerRef.current = window.setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        if (pollerRef.current !== null) {
          window.clearInterval(pollerRef.current);
          pollerRef.current = null;
        }
        setPending(false);
        return;
      }
      try {
        const fresh = await getRoom(eventId);
        if (fresh?.chat_invite_url) {
          setRoom(fresh);
          setPending(false);
          onRoomChange?.(fresh);
          if (pollerRef.current !== null) {
            window.clearInterval(pollerRef.current);
            pollerRef.current = null;
          }
        }
      } catch {
        // Transient errors during polling are expected (the user is in
        // Telegram creating the group; the room may not exist yet). Keep
        // polling until timeout.
      }
    }, POLL_INTERVAL_MS);
  }

  function openExisting() {
    if (!inviteUrl) return;
    openTgLink(inviteUrl);
  }

  if (inviteUrl) {
    return (
      <Button type="button" variant="outline" className="h-11 w-full" onClick={openExisting}>
        <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
        Чат події
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      className="h-11 w-full"
      onClick={startCreate}
      disabled={pending}
    >
      <MessageCircle className="mr-1.5 h-4 w-4" aria-hidden />
      {pending ? "Чекаю на чат…" : "Створити чат"}
    </Button>
  );
}
