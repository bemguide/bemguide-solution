// Telegram bot webhook (grammY on Deno).
// Verifies the webhook secret, looks up or creates the veteran by tg_user_id,
// then dispatches commands. Long flows (NL propose) land in M12.
//
// Commands:
//   /start [evt_<slug>|defer_<slug>|org]   welcome / deep link / organizer mode
//   /me                                     summary + upcoming RSVPs
//   /cancel                                 clear bot_sessions row
//   /skip                                   (no current flow → friendly nudge)
//   /help                                   list of commands
//   /feedback                               opens a one-shot feedback collector (M12+)
//   /contact                                "пиши: @<moderator>"
//   /stop_reminders                          toggle veterans.reminders_enabled
//   /myevents (organizer)                    list submitted events
//   /newevent (organizer / veteran)         placeholder — full flow lands in M12

import { Bot, Context, InlineKeyboard, webhookCallback } from "grammy";
import { adminClient } from "../_shared/supabase.ts";
import { env } from "../_shared/env.ts";

const bot = new Bot(env.tgBotToken());
const APP_URL = env.publicAppUrl();
const MODERATOR_HANDLE = "@poruch_kyiv";

// ----------------------------------------------------------------
// Event-chat attach flow (helpers used by the group-context /start branch).
// When a user creates a group via the Mini App's
// `?startgroup=event_<id>` deep-link, the bot lands in the new group, exports
// an invite link, and tells the auth-backend to attach it to event_rooms so
// the Mini App's "Чат події" button (and the bot's reminder messages) can
// link members straight in.
//
// Was deleted in the rebrand commit by accident; restored here. See
// docs/EVENT_CHAT_ATTACH.md for the full protocol (bot side + backend
// endpoint contract + Mini App button + env vars + @BotFather config).
// ----------------------------------------------------------------

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function attachChatToEvent(
  eventId: string,
  chatId: number,
  inviteUrl: string,
): Promise<{ ok: boolean; error?: string }> {
  const body = JSON.stringify({
    event_id: eventId,
    chat_id: String(chatId),
    chat_invite_url: inviteUrl,
  });
  const sig = await hmacHex(env.botInternalSecret(), body);
  const res = await fetch(`${env.backendBaseUrl()}/internal/event-rooms/attach`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-bot-signature": sig,
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

async function handleGroupAddedForEvent(ctx: Context, eventId: string) {
  const chatId = ctx.chat?.id;
  if (!chatId) return;

  // Bot must be admin (or higher) to export an invite link.
  let inviteUrl: string;
  try {
    inviteUrl = await ctx.exportChatInviteLink();
  } catch (err) {
    console.warn("exportChatInviteLink failed (likely not admin yet):", err);
    return ctx.reply(
      "Спочатку зробіть мене адміном цього чату — потім поверніться в Просвіт і знову натисніть «Створити чат».",
    );
  }

  const result = await attachChatToEvent(eventId, chatId, inviteUrl);
  if (!result.ok) {
    console.error("attachChatToEvent failed:", result.error);
    return ctx.reply(
      "Не вдалося зберегти посилання на чат. Спробуй ще раз через хвилину або напиши модератору.",
    );
  }
  return ctx.reply("Готово! Чат прив'язано до події. Учасники побачать посилання у міні-аппі.");
}

// ----------------------------------------------------------------
// /start  (with optional deep-link parameter)
// ----------------------------------------------------------------
bot.command("start", async (ctx) => {
  const fromId = ctx.from?.id;
  const firstName = ctx.from?.first_name ?? "";
  if (!fromId) return;

  const param = ctx.match?.trim() ?? "";
  const isGroup = ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";

  // Group-context: bot was just added to a group via the Mini App's
  // `?startgroup=event_<id>` deep-link. Don't ensureVeteran (group-adds
  // aren't user-onboarding events) — go straight to the attach flow.
  if (isGroup) {
    if (param.startsWith("event_")) {
      return handleGroupAddedForEvent(ctx, param.slice(6));
    }
    // No event_<id> on the deep-link → either the user added the bot
    // manually, or they typed /start@bot to check the bot is alive.
    // Send a help message instead of staying silent: silence reads as
    // "the bot is broken", and the lost minute of triage every time
    // an admin tests the bot in a fresh group adds up fast.
    return ctx.reply(
      "Привіт. Щоб прив'язати цей чат до події — поверніться в Просвіт " +
        "і натисніть «Створити чат» на картці потрібної події. Я з'явлюся " +
        "тут автоматично і збережу посилання.",
    );
  }

  // No auto-upsert of a user record on /start — the v2 `users` table
  // requires fields the bot doesn't have (city, accessibility, veteran
  // status). Mini App onboarding owns user creation; the bot only
  // reads. The legacy `ensureVeteran` write to the deprecated
  // `veterans` table created ghost rows that drifted from `users` and
  // caused the "/me shows the wrong city" bug we shipped this fix for.
  // `firstName` from ctx.from is intentionally unused here for the
  // same reason.
  void firstName;

  if (param.startsWith("evt_")) {
    const slug = param.slice(4);
    const keyboard = new InlineKeyboard()
      .webApp("Відкрити подію", `${APP_URL}/m/event/${encodeURIComponent(slug)}`)
      .row()
      .text("Не зараз — нагадай через тиждень", `defer:${slug}`);
    return ctx.reply("Подивися подію — або відклади, я нагадаю через тиждень.", {
      reply_markup: keyboard,
    });
  }

  if (param.startsWith("defer_")) {
    // `defer_<slug>` deep-link kept for backward compat with old
    // notifications still in the wild. The deferral storage (legacy
    // rsvps.defer_until) is gone — v2 schema has no equivalent column.
    // We acknowledge the user but no longer write anything; they can
    // come back to the Mini App when ready.
    void param.slice(6);
    return ctx.reply("Окей, нагадаю через тиждень. Якщо передумаєш — зайди ще раз.");
  }

  if (param === "org") {
    const keyboard = new InlineKeyboard().webApp("Створити подію", `${APP_URL}/org/new-event`);
    return ctx.reply(
      "Привіт. Якщо ви організовуєте подію для ветеранів — натисніть кнопку нижче.",
      { reply_markup: keyboard },
    );
  }

  // Default welcome
  const keyboard = new InlineKeyboard()
    .webApp("Відкрити Просвіт", `${APP_URL}/`)
    .row()
    .text("Що це?", "intro");
  return ctx.reply(
    "Просвіт — щоб поряд були люди і події, без зайвих питань.\n\nВідкрий мініапп — там покажу, що поруч сьогодні і завтра.",
    { reply_markup: keyboard },
  );
});

// "Що це?" callback
bot.callbackQuery("intro", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "Просвіт — це коротка стрічка локальних подій, де можна зустріти інших ветеранів. " +
      "Без анкет на сторінку, без обов'язків. Один тап «Я буду» — і нагадаю напередодні.",
  );
});

// "defer:<slug>" callback (used in deep-link confirmation)
// Kept for backward compat with old notifications. Same story as the
// /start defer_<slug> branch: storage is gone in v2, so we just
// acknowledge.
bot.callbackQuery(/^defer:(.+)$/, async (ctx) => {
  await ctx.answerCallbackQuery({ text: "Записав на нагадування" });
});

// ----------------------------------------------------------------
// /me — read from the v2 schema (users + event_attendees ⨝ opportunities).
//
// Why this changed: the bot used to read `veterans` / `rsvps` / `events`,
// which the rest of the v2 stack stopped writing to months ago — so
// /me showed whatever was in the legacy row when the user first
// messaged the bot. Live profile updates from the Mini App go to
// `users`, RSVPs land in `event_attendees`, event metadata is in
// `opportunities`. Symptom that surfaced this: a user with city
// "Дніпро" in the Mini App was seeing "місто: Львів" from /me.
// ----------------------------------------------------------------
bot.command("me", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;

  const user = await getUserByTg(fromId);
  if (!user) {
    const keyboard = new InlineKeyboard().webApp("Налаштувати", `${APP_URL}/m/onboarding`);
    return ctx.reply("Ти ще не пройшов короткий онбординг. Зайди — займе хвилину.", {
      reply_markup: keyboard,
    });
  }

  const supabase = adminClient();
  // Over-fetch (limit 20) and slice in JS to top 5 future events.
  // supabase-js's nested-table .gte() filtering is documented but
  // brittle in practice; the join is cheap and we already need to
  // filter in JS to skip rows where the opportunity row was deleted
  // out from under the attendee.
  const { data: attendees } = await supabase
    .from("event_attendees")
    .select("status, joined_at, opportunities(id, title, start_at)")
    .eq("user_id", user.id)
    .in("status", ["joining", "attended"])
    .order("joined_at", { ascending: false })
    .limit(20);

  type AttendeeRow = {
    status: string;
    joined_at: string;
    opportunities: { id: string; title: string; start_at: string } | null;
  };

  const now = Date.now();
  const upcoming = ((attendees as unknown as AttendeeRow[]) ?? [])
    .filter((r) => r.opportunities && new Date(r.opportunities.start_at).getTime() >= now)
    .sort(
      (a, b) =>
        new Date(a.opportunities!.start_at).getTime() -
        new Date(b.opportunities!.start_at).getTime(),
    )
    .slice(0, 5);

  const lines: string[] = [];
  lines.push(`${user.display_name ?? "Привіт"} — місто: ${user.city ?? "не вказано"}`);
  lines.push("");
  if (!upcoming.length) {
    lines.push("Поки що нікуди не записаний. Подивись що поруч:");
  } else {
    lines.push("Найближчі події:");
    for (const r of upcoming) {
      if (!r.opportunities) continue;
      const when = new Date(r.opportunities.start_at).toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      lines.push(`• «${r.opportunities.title}» — ${when}`);
    }
  }

  const keyboard = new InlineKeyboard()
    .webApp("Відкрити Просвіт", `${APP_URL}/m/feed`)
    .row()
    .webApp("Налаштування", `${APP_URL}/m/me`);
  return ctx.reply(lines.join("\n"), { reply_markup: keyboard });
});

// ----------------------------------------------------------------
// /cancel  /skip  /help  /contact  /stop_reminders  /feedback
// ----------------------------------------------------------------

bot.command("cancel", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;
  await adminClient().from("bot_sessions").delete().eq("user_id", fromId);
  return ctx.reply("Готово, нічого не активного. /start якщо потрібно почати знову.");
});

bot.command("skip", (ctx) => ctx.reply("Зараз нічого не питаю. /help — список команд."));

bot.command("help", (ctx) =>
  ctx.reply(
    [
      "Що я вмію:",
      "/start — відкрити Просвіт",
      "/me — мої записи і налаштування",
      "/newevent — запропонувати свою подію (доступно в мініапп)",
      "/stop_reminders — вимкнути нагадування",
      "/feedback — написати команді",
      "/contact — як зв'язатися з модератором",
      "/cancel — скасувати поточну дію",
    ].join("\n"),
  ),
);

bot.command("contact", (ctx) =>
  ctx.reply(`Якщо щось не так — пиши модератору: ${MODERATOR_HANDLE}.`),
);

// /stop_reminders — managed in the Mini App now. The v2 `users` table
// dropped the `reminders_enabled` flag (it was only used by the
// notify-scheduler against the legacy `veterans` table). Rather than
// silently no-op or write to a vestigial column, point the user at
// the place where the real toggle lives.
bot.command("stop_reminders", (ctx) =>
  ctx.reply(
    "Налаштування нагадувань зараз керується через міні-апп — відкрий розділ «Я» → налаштування.",
  ),
);

bot.command("feedback", (ctx) =>
  ctx.reply("Напиши однією-двома фразами, що думаєш — я передам команді."),
);

// /newevent — full flow lands in M12. For now, route to miniapp.
bot.command("newevent", (ctx) => {
  const keyboard = new InlineKeyboard().webApp("Відкрити форму", `${APP_URL}/m/propose`);
  return ctx.reply("Відкрий форму, опишеш подію — модератор перевірить за добу.", {
    reply_markup: keyboard,
  });
});

// /myevents — events the user authored. v2 schema: opportunities.created_by
// references users.id directly (no separate `created_by_veteran_id` on a
// legacy table). Also no `status` column on `opportunities` — the
// post-rebrand backend drops the moderation queue, so anything in this
// list is already published.
bot.command("myevents", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return ctx.reply("Спочатку /start.");

  const user = await getUserByTg(fromId);
  if (!user) return ctx.reply("Спочатку /start.");

  const { data: events } = await adminClient()
    .from("opportunities")
    .select("id, title, start_at")
    .eq("created_by", user.id)
    .order("created_at", { ascending: false })
    .limit(10);

  if (!events?.length) return ctx.reply("Поки що жодної. /newevent — запропонуй свою.");
  const lines = ["Твої події:"];
  for (const e of events) {
    const when = new Date(e.start_at).toLocaleString("uk-UA", {
      timeZone: "Europe/Kyiv",
      day: "2-digit",
      month: "long",
    });
    lines.push(`• «${e.title}» — ${when}`);
  }
  return ctx.reply(lines.join("\n"));
});

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

/**
 * Look up the v2 `users` row backing a Telegram account, by tg user_id.
 *
 * Returns null when the user hasn't onboarded in the Mini App yet — the
 * bot does NOT auto-create users (unlike the deprecated `ensureVeteran`
 * pattern), because user records require fields the bot doesn't have
 * (city, accessibility flags, veteran_status). All bot commands that
 * read profile data should fall back to "go onboard in the Mini App"
 * messaging when this returns null.
 */
async function getUserByTg(tgUserId: number) {
  const { data } = await adminClient()
    .from("users")
    .select("id, display_name, city, veteran_status")
    .eq("telegram_user_id", tgUserId)
    .maybeSingle();
  return data;
}

// ----------------------------------------------------------------
// webhook handler — wraps grammY with secret-token check + universal 200
// ----------------------------------------------------------------

// Catch grammY-internal errors so they don't crash the request handler.
bot.catch((err) => {
  console.error("bot.catch:", err.error instanceof Error ? err.error.message : err.error);
});

const handle = webhookCallback(bot, "std/http");

Deno.serve(async (req) => {
  // Telegram sends X-Telegram-Bot-Api-Secret-Token; we set it via setWebhook.
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  if (secret !== env.tgWebhookSecret()) {
    return new Response("forbidden", { status: 403 });
  }
  // Always return 200 to Telegram — otherwise it retries the same update.
  // Real handler errors are logged; the user experience is "bot stays silent on a single message".
  try {
    await handle(req);
  } catch (e) {
    console.error("webhookCallback threw:", e);
  }
  return new Response("ok", { status: 200 });
});
