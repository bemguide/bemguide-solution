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

import { Bot, InlineKeyboard, webhookCallback } from "grammy";
import { adminClient } from "../_shared/supabase.ts";
import { env } from "../_shared/env.ts";

const bot = new Bot(env.tgBotToken());
const APP_URL = env.publicAppUrl();
const MODERATOR_HANDLE = "@poruch_kyiv";

// ----------------------------------------------------------------
// /start  (with optional deep-link parameter)
// ----------------------------------------------------------------
bot.command("start", async (ctx) => {
  const fromId = ctx.from?.id;
  const firstName = ctx.from?.first_name ?? "";
  if (!fromId) return;

  // Normalise/upsert the veteran by tg_user_id. We capture only display_name on
  // first contact; full onboarding happens in the Mini App.
  await ensureVeteran(fromId, firstName);

  const param = ctx.match?.trim() ?? "";

  if (param.startsWith("evt_")) {
    const slug = param.slice(4);
    const keyboard = new InlineKeyboard()
      .webApp("Відкрити подію", `${APP_URL}/m/event/${encodeURIComponent(slug)}`)
      .row()
      .text("Не зараз — нагадай через тиждень", `defer:${slug}`);
    return ctx.reply(
      "Подивися подію — або відклади, я нагадаю через тиждень.",
      { reply_markup: keyboard },
    );
  }

  if (param.startsWith("defer_")) {
    const slug = param.slice(6);
    await deferRsvp(fromId, slug);
    return ctx.reply("Окей, нагадаю через тиждень. Якщо передумаєш — зайди ще раз.");
  }

  if (param === "org") {
    const keyboard = new InlineKeyboard().webApp(
      "Створити подію",
      `${APP_URL}/org/new-event`,
    );
    return ctx.reply(
      "Привіт. Якщо ви організовуєте подію для ветеранів — натисніть кнопку нижче.",
      { reply_markup: keyboard },
    );
  }

  // Default welcome
  const keyboard = new InlineKeyboard()
    .webApp("Відкрити Поруч", `${APP_URL}/m/onboarding`)
    .row()
    .text("Що це?", "intro");
  return ctx.reply(
    "Поруч — щоб поряд були люди і події, без зайвих питань.\n\nВідкрий мініапп — там покажу, що поруч сьогодні і завтра.",
    { reply_markup: keyboard },
  );
});

// "Що це?" callback
bot.callbackQuery("intro", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.reply(
    "Поруч — це коротка стрічка локальних подій, де можна зустріти інших ветеранів. " +
      "Без анкет на сторінку, без обов'язків. Один тап «Я буду» — і нагадаю напередодні.",
  );
});

// "defer:<slug>" callback (used in deep-link confirmation)
bot.callbackQuery(/^defer:(.+)$/, async (ctx) => {
  const slug = ctx.match?.[1] ?? "";
  const fromId = ctx.from?.id;
  if (fromId && slug) await deferRsvp(fromId, slug);
  await ctx.answerCallbackQuery({ text: "Записав на нагадування" });
});

// ----------------------------------------------------------------
// /me
// ----------------------------------------------------------------
bot.command("me", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;

  const supabase = adminClient();
  const { data: veteran } = await supabase
    .from("veterans")
    .select("id, display_name, city, reminders_enabled")
    .eq("tg_user_id", fromId)
    .maybeSingle();

  if (!veteran) {
    const keyboard = new InlineKeyboard().webApp("Налаштувати", `${APP_URL}/m/onboarding`);
    return ctx.reply("Ти ще не пройшов короткий онбординг. Зайди — займе хвилину.", {
      reply_markup: keyboard,
    });
  }

  const { data: rsvps } = await supabase
    .from("rsvps")
    .select("status, events(title, start_at, slug)")
    .eq("veteran_id", veteran.id)
    .in("status", ["going", "deferred"])
    .order("created_at", { ascending: false })
    .limit(5);

  type Row = { status: string; events: { title: string; start_at: string; slug: string } | null };
  const lines: string[] = [];
  lines.push(`${veteran.display_name ?? "Привіт"} — місто: ${veteran.city ?? "не вказано"}`);
  lines.push(
    veteran.reminders_enabled ? "Нагадування: увімкнено" : "Нагадування: вимкнено",
  );
  lines.push("");
  if (!rsvps?.length) {
    lines.push("Поки що нікуди не записаний. Подивись що поруч:");
  } else {
    lines.push("Найближчі записи:");
    for (const r of (rsvps as unknown as Row[]) ?? []) {
      if (!r.events) continue;
      const when = new Date(r.events.start_at).toLocaleString("uk-UA", {
        timeZone: "Europe/Kyiv",
        day: "2-digit",
        month: "long",
        hour: "2-digit",
        minute: "2-digit",
      });
      lines.push(`• «${r.events.title}» — ${when}${r.status === "deferred" ? " (відкладено)" : ""}`);
    }
  }

  const keyboard = new InlineKeyboard()
    .webApp("Відкрити Поруч", `${APP_URL}/m/feed`)
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
      "/start — відкрити Поруч",
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

bot.command("stop_reminders", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return;
  const supabase = adminClient();
  const { data: veteran } = await supabase
    .from("veterans")
    .select("id, reminders_enabled")
    .eq("tg_user_id", fromId)
    .maybeSingle();
  if (!veteran) return ctx.reply("Спочатку /start.");
  const next = !veteran.reminders_enabled;
  await supabase.from("veterans").update({ reminders_enabled: next }).eq("id", veteran.id);
  return ctx.reply(
    next
      ? "Нагадування знову увімкнені."
      : "Нагадування вимкнено. Команда /stop_reminders ще раз — увімкне.",
  );
});

bot.command("feedback", (ctx) =>
  ctx.reply("Напиши однією-двома фразами, що думаєш — я передам команді."),
);

// /newevent — full flow lands in M12. For now, route to miniapp.
bot.command("newevent", (ctx) => {
  const keyboard = new InlineKeyboard().webApp(
    "Відкрити форму",
    `${APP_URL}/m/propose`,
  );
  return ctx.reply("Відкрий форму, опишеш подію — модератор перевірить за добу.", {
    reply_markup: keyboard,
  });
});

// /myevents — placeholder
bot.command("myevents", async (ctx) => {
  const fromId = ctx.from?.id;
  if (!fromId) return ctx.reply("Спочатку /start.");
  const supabase = adminClient();
  const { data: veteran } = await supabase
    .from("veterans")
    .select("id")
    .eq("tg_user_id", fromId)
    .maybeSingle();
  if (!veteran) return ctx.reply("Спочатку /start.");
  const { data: events } = await supabase
    .from("events")
    .select("title, status, slug")
    .eq("created_by_veteran_id", veteran.id)
    .order("created_at", { ascending: false })
    .limit(10);
  if (!events?.length) return ctx.reply("Поки що жодної. /newevent — запропонуй свою.");
  const lines = ["Твої події:"];
  for (const e of events) lines.push(`• «${e.title}» — ${e.status}`);
  return ctx.reply(lines.join("\n"));
});

// ----------------------------------------------------------------
// helpers
// ----------------------------------------------------------------

async function ensureVeteran(tgUserId: number, firstName: string): Promise<void> {
  const supabase = adminClient();
  const { data: existing } = await supabase
    .from("veterans")
    .select("id, display_name, last_active_at")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  if (!existing) {
    await supabase.from("veterans").insert({
      tg_user_id: tgUserId,
      display_name: firstName || null,
      language: "uk",
      last_active_at: new Date().toISOString(),
    });
    return;
  }
  await supabase
    .from("veterans")
    .update({ last_active_at: new Date().toISOString() })
    .eq("id", existing.id);
}

async function deferRsvp(tgUserId: number, eventSlug: string): Promise<void> {
  const supabase = adminClient();
  const { data: veteran } = await supabase
    .from("veterans")
    .select("id")
    .eq("tg_user_id", tgUserId)
    .maybeSingle();
  if (!veteran) return;
  const { data: event } = await supabase
    .from("events")
    .select("id")
    .eq("slug", eventSlug)
    .maybeSingle();
  if (!event) return;

  const deferUntil = new Date();
  deferUntil.setDate(deferUntil.getDate() + 7);

  await supabase.from("rsvps").upsert(
    {
      veteran_id: veteran.id,
      event_id: event.id,
      status: "deferred",
      defer_until: deferUntil.toISOString(),
    },
    { onConflict: "veteran_id,event_id" },
  );
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
