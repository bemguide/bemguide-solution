// Notification message rendering. Each template returns plain text + an
// optional inline_keyboard. Both the synchronous rsvp_confirm path (called
// from rsvp-create) and the async cron dispatcher use these helpers, so
// copy stays consistent between channels.
//
// Tone rules (per master brief): no exclamation marks, no English jargon,
// no military framing. Emoji limited to the documented functional set
// (📍 ⏰ 📅 📷 ⚠️) — no decorative ones.

import { env } from "./env.ts";

export type EventCtx = {
  id: string;
  slug: string;
  title: string;
  address: string | null;
  start_at: string;
  organizer_contact: string | null;
};

export type RsvpCtx = {
  id: string;
  qr_token: string | null;
  veteran_display_name: string | null;
};

export type SocialProof = { going_count: number; names_visible: string[] };

const TG_BOT_NAME = (() => {
  try {
    return env.tgBotUsername();
  } catch {
    return "poruch_bot";
  }
})();

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    day: "numeric",
    month: "long",
  });
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("uk-UA", {
    timeZone: "Europe/Kyiv",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function appUrl(path: string): string {
  try {
    return `${env.publicAppUrl()}${path}`;
  } catch {
    return path;
  }
}

function fnUrl(path: string): string {
  try {
    return env.supabaseUrl().replace(/\.supabase\.co.*$/, ".supabase.co/functions/v1") + path;
  } catch {
    return path;
  }
}

function socialProofLine(p: SocialProof, exclude: string | null): string {
  const others = p.names_visible.filter((n) => n !== exclude);
  if (p.going_count <= 1) return "";
  if (others.length === 0) return `${p.going_count} ветеранів іде.`;
  if (others.length === 1) return `${others[0]} і ще ${p.going_count - 1} підтвердили.`;
  return `${others[0]}, ${others[1]} і ще ${p.going_count - 2} підтвердили.`;
}

type InlineButton = { text: string; url: string } | { text: string; callback_data: string };

export type RenderedNotification = {
  text: string;
  reply_markup?: { inline_keyboard: InlineButton[][] };
};

// ----------------------------------------------------------------
// rsvp_confirm
// ----------------------------------------------------------------
export function renderRsvpConfirm(event: EventCtx, rsvp: RsvpCtx): RenderedNotification {
  const lines = [
    `Записав на «${event.title}».`,
    `${fmtDate(event.start_at)}, ${fmtTime(event.start_at)}.`,
    "",
  ];
  if (event.address) lines.push(`📍 ${event.address}`);
  lines.push("");
  lines.push("Нагадаю напередодні і за 10 хвилин до старту.");
  lines.push("Якщо плани зміняться — натисни «Не зможу», нагадування зніму.");

  const buttons: InlineButton[][] = [];
  if (rsvp.qr_token) {
    buttons.push([
      {
        text: "📅 Додати в календар",
        url: `${fnUrl(`/ics-generate?rsvp_id=${rsvp.id}&token=${rsvp.qr_token}`)}`,
      },
    ]);
    buttons.push([
      {
        text: "📷 Мій QR",
        url: `https://api.qrserver.com/v1/create-qr-code/?size=320x320&data=${encodeURIComponent(`https://t.me/${TG_BOT_NAME}?start=rsvp_${rsvp.id}_${rsvp.qr_token}`)}`,
      },
    ]);
  }
  buttons.push([
    {
      text: "Відкрити подію",
      url: appUrl(`/event/${event.slug}`),
    },
  ]);
  buttons.push([{ text: "❌ Не зможу", callback_data: `cancel:${rsvp.id}` }]);

  return { text: lines.join("\n"), reply_markup: { inline_keyboard: buttons } };
}

// ----------------------------------------------------------------
// reminder_24h
// ----------------------------------------------------------------
export function renderReminder24h(
  event: EventCtx,
  rsvp: RsvpCtx,
  social: SocialProof,
): RenderedNotification {
  const greet = rsvp.veteran_display_name ? `${rsvp.veteran_display_name},` : "Привіт,";
  const place = event.address ? `\n📍 ${event.address}.` : "";
  const proof = socialProofLine(social, rsvp.veteran_display_name);
  const proofLine = proof ? `\n\n${proof}` : "";
  const text = [
    `${greet} завтра ${fmtTime(event.start_at)} — «${event.title}».${place}${proofLine}`,
    "",
    "Якщо плани зміняться — натисни «Не зможу».",
  ].join("\n");
  return {
    text,
    reply_markup: {
      inline_keyboard: [
        [{ text: "Відкрити подію", url: appUrl(`/event/${event.slug}`) }],
        [{ text: "❌ Не зможу", callback_data: `cancel:${rsvp.id}` }],
      ],
    },
  };
}

// ----------------------------------------------------------------
// reminder_10m
// ----------------------------------------------------------------
export function renderReminder10m(event: EventCtx, _rsvp: RsvpCtx): RenderedNotification {
  const lines = [`Старт за 10 хвилин — «${event.title}».`];
  if (event.organizer_contact) lines.push(`Якщо щось — пиши: ${event.organizer_contact}.`);
  return { text: lines.join("\n") };
}

// ----------------------------------------------------------------
// post_event survey
// ----------------------------------------------------------------
export function renderPostEvent(event: EventCtx, rsvp: RsvpCtx): RenderedNotification {
  return {
    text: `Як було на «${event.title}»?`,
    reply_markup: {
      inline_keyboard: [
        [
          { text: "👍 нормально", callback_data: `rate:${rsvp.id}:up` },
          { text: "😐 так собі", callback_data: `rate:${rsvp.id}:meh` },
          { text: "👎 не пішло", callback_data: `rate:${rsvp.id}:down` },
        ],
      ],
    },
  };
}

// ----------------------------------------------------------------
// event_published — for organizers / veteran-authors
// ----------------------------------------------------------------
export function renderEventPublished(event: EventCtx): RenderedNotification {
  return {
    text: [
      `Твоя подія «${event.title}» опублікована.`,
      "",
      `Подивитися: ${appUrl(`/event/${event.slug}`)}`,
      "Поділитися можна одним натиском.",
    ].join("\n"),
    reply_markup: {
      inline_keyboard: [[{ text: "Відкрити сторінку події", url: appUrl(`/event/${event.slug}`) }]],
    },
  };
}

export async function tgSend(chatId: number, n: RenderedNotification): Promise<boolean> {
  const token = env.tgBotToken();
  const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: n.text,
      reply_markup: n.reply_markup,
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) {
    console.warn(`tgSend ${res.status}:`, (await res.text()).slice(0, 200));
    return false;
  }
  return true;
}
