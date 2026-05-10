// Build a Telegram Mini App deep link for an event. Recipients who
// tap it open Telegram and land directly in /m/event/[id] through
// the `start_param=evt_<id>` bypass on the / route — i.e. they get
// the in-app experience (RSVP button, attendees, chat link), not
// the public web page.
//
// `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` must be set on the deploy for
// this to work. When it isn't, we fall back to the public /event/[id]
// URL so the recipient at least gets the right page in a browser —
// just outside Telegram.

"use client";

const BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME?.trim();

export function buildEventShareUrl(eventId: string): string {
  if (BOT) return `https://t.me/${BOT}?startapp=evt_${eventId}`;
  if (typeof window !== "undefined") {
    return `${window.location.origin}/event/${eventId}`;
  }
  return `/event/${eventId}`;
}

/**
 * Deep link that prompts the user to add the bot to a Telegram group.
 * Telegram passes `evt_<eventId>` as the bot's start payload when it
 * joins, so the bot can call `POST /internal/event-rooms/attach` with
 * the right event_id + the chat_id of the group it was added to.
 *
 * Returns null when `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME` is unset —
 * the calling UI should hide the affordance entirely in that case
 * (there's no useful fallback for adding-bot-to-group outside TG).
 */
export function buildCreateChatUrl(eventId: string): string | null {
  if (!BOT) return null;
  return `https://t.me/${BOT}?startgroup=evt_${eventId}`;
}
