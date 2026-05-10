// Centralised mapping from backend error codes → Ukrainian user-facing
// strings. Backend doesn't localise (only emits codes), so the UI is on
// the hook for translation. Keep this list flat — the surrounding context
// usually says enough that we don't need per-route variants.

import { ApiError } from "./client";

const TELEGRAM_DOWN = "Сервіс тимчасово не відповідає. Спробуй за хвилину.";
const NEEDS_TG = "Відкрий додаток у Telegram, щоб продовжити.";
const SESSION_LOST = "Сесія завершилась. Закрий і відкрий додаток ще раз.";

export type ErrorContext =
  | "feed"
  | "rsvp"
  | "onboarding"
  | "propose"
  | "check-in"
  | "default";

/**
 * Translate any thrown value into a UA string fit for a toast / inline
 * error. Keeps the original `ApiError.message` (the backend code) on
 * the error itself so callers that need to branch on `event_started`
 * vs `already_rsvped` etc still can.
 */
export function describeError(e: unknown, ctx: ErrorContext = "default"): string {
  if (!(e instanceof ApiError)) {
    return e instanceof Error ? e.message : "Щось пішло не так. Спробуй ще раз.";
  }

  // Network / config errors — no HTTP status from the server.
  if (e.message === "NEXT_PUBLIC_API_BASE is not set") {
    return "Бекенд ще не підключений (NEXT_PUBLIC_API_BASE).";
  }
  if (e.message === "no_telegram_environment") return NEEDS_TG;
  if (e.status === 0) return "Не вдалось дістатися сервера.";

  // Backend-issued codes (see auth-backend/src/utils/errors.ts).
  switch (e.message) {
    // Auth surface.
    case "invalid_init_data":
      return "Telegram-підпис не пройшов перевірку. Закрий і відкрий додаток.";
    case "expired_init_data":
      return "Twoя сесія Telegram застаріла. Закрий і відкрий додаток.";
    case "unauthorized":
    case "expired":
      return SESSION_LOST;

    // RSVP surface.
    case "event_started":
      return "Подія вже почалася.";
    case "already_rsvped":
      return "Ти вже відповів на цю подію.";
    case "not_attendee":
      return "Спершу запишись на подію.";

    // Resource not-found.
    case "opportunity_not_found":
      return "Цю подію не знайдено.";
    case "user_not_found":
      return "Профіль не знайдено. Закрий і відкрий додаток.";
    case "not_found":
      return "Не знайдено.";

    // Validation.
    case "validation_failed":
      return ctx === "propose"
        ? "Перевір поля — щось не пройшло валідацію."
        : "Перевір введені дані.";

    case "rate_limited":
      return "Забагато запитів. Зачекай хвилинку.";

    // Check-in surface — backend only allows admins or the event's tracked
    // organizer (opportunities.created_by == req.user.id). Any other authed
    // caller hits 403 'forbidden' with this message.
    case "forbidden":
      return ctx === "check-in"
        ? "Бекенд не визнає тебе організатором цієї події. Якщо подія твоя — попроси адміна вписати твій user_id у opportunities.created_by."
        : "Немає доступу.";

    // Backend infra.
    case "upstream":
    case "internal":
      return TELEGRAM_DOWN;
  }

  // Fall back to status code.
  if (e.status === 401) return SESSION_LOST;
  if (e.status === 403) {
    return ctx === "check-in"
      ? "Бекенд не визнає тебе організатором цієї події."
      : "Немає доступу.";
  }
  if (e.status === 404) return "Не знайдено.";
  if (e.status === 409) return "Конфлікт. Перезавантаж сторінку.";
  if (e.status === 429) return "Забагато запитів. Зачекай хвилинку.";
  if (e.status >= 500) return TELEGRAM_DOWN;

  return e.message;
}

/** True when the error means "you're not in Telegram" — UI routes to CTA. */
export function isNoTelegramEnv(e: unknown): boolean {
  return e instanceof ApiError && e.message === "no_telegram_environment";
}

/**
 * Extract the backend's `details` field (when present). The auth-backend
 * sets it for outage codes — `upstream` carries the original Supabase /
 * Telegram / Gemini error message, `validation_failed` carries
 * `fieldErrors`. Useful for debug logging; surface to users only when
 * `NODE_ENV !== production` (English text + internal field names).
 */
export function errorDetails(e: unknown): unknown {
  if (!(e instanceof ApiError)) return undefined;
  const body = e.body;
  if (typeof body !== "object" || body === null) return undefined;
  return (body as { details?: unknown }).details;
}

/**
 * `console.warn` an ApiError in a form that's actually useful for
 * debugging — surfaces the backend's `error` code + `details` (e.g.
 * "Invalid API key" from Supabase) instead of the cryptic stack trace
 * Next.js renders in dev. No-op in production except for the bare
 * console.warn so we don't ship `details` to the browser.
 */
export function logApiError(tag: string, e: unknown): void {
  if (e instanceof ApiError) {
    const details = errorDetails(e);
    if (details !== undefined && process.env.NODE_ENV !== "production") {
      console.warn(`[${tag}] ${e.message} (HTTP ${e.status}):`, details);
    } else {
      console.warn(`[${tag}] ${e.message} (HTTP ${e.status})`);
    }
    return;
  }
  console.warn(`[${tag}]`, e);
}
