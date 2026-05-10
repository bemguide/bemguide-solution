// ics-generate — emits a text/calendar (.ics) file for a confirmed RSVP.
//
// GET /ics-generate?rsvp_id=<uuid>&token=<qr_token>
//
// Public: anyone with the matching rsvp_id + qr_token can download. The token
// is generated server-side at RSVP time so guessing without the user's tap is
// impractical.

import { handleCors } from "../_shared/cors.ts";
import { adminClient } from "../_shared/supabase.ts";
import { env } from "../_shared/env.ts";

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function icsDate(d: Date): string {
  // YYYYMMDDTHHMMSSZ — Z-time per RFC 5545.
  return (
    d.getUTCFullYear().toString() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds()) +
    "Z"
  );
}

function escapeText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const url = new URL(req.url);
  const rsvpId = url.searchParams.get("rsvp_id");
  const token = url.searchParams.get("token");
  if (!rsvpId || !token) {
    return new Response("rsvp_id and token required", { status: 400 });
  }

  const supabase = adminClient();
  const { data: rsvp, error: rsvpErr } = await supabase
    .from("rsvps")
    .select("id, qr_token, event_id, status")
    .eq("id", rsvpId)
    .maybeSingle();
  if (rsvpErr || !rsvp) return new Response("rsvp not found", { status: 404 });
  if (rsvp.qr_token !== token) return new Response("token mismatch", { status: 403 });
  if (rsvp.status !== "going") return new Response("rsvp not active", { status: 409 });

  const { data: event } = await supabase
    .from("events")
    .select("title, slug, description, address, city, organizer_contact, start_at, duration_min")
    .eq("id", rsvp.event_id)
    .maybeSingle();
  if (!event) return new Response("event not found", { status: 404 });

  const start = new Date(event.start_at);
  const end = new Date(start.getTime() + (event.duration_min ?? 60) * 60_000);
  const now = new Date();

  const description = [
    event.description ?? "",
    event.organizer_contact ? `Контакт: ${event.organizer_contact}` : "",
    "Згенеровано Просвітом.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const location = [event.city, event.address].filter(Boolean).join(", ");
  const slug = event.slug;
  const publicUrl = `${env.publicAppUrl()}/event/${slug}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Просвіт//uk//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${rsvp.id}@poruch`,
    `DTSTAMP:${icsDate(now)}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${escapeText(event.title)}`,
    `DESCRIPTION:${escapeText(description)}`,
    `LOCATION:${escapeText(location)}`,
    `URL:${publicUrl}`,
    // T-24h reminder
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Завтра — ${event.title}`)}`,
    "TRIGGER:-PT24H",
    "END:VALARM",
    // T-10m reminder
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(`Старт за 10 хвилин — ${event.title}`)}`,
    "TRIGGER:-PT10M",
    "END:VALARM",
    "END:VEVENT",
    "END:VCALENDAR",
  ];

  return new Response(lines.join("\r\n"), {
    status: 200,
    headers: {
      "content-type": "text/calendar; charset=utf-8",
      "content-disposition": `attachment; filename="poruch-${slug}.ics"`,
    },
  });
});
