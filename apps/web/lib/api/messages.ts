// Centralised mapping from backend error codes → Ukrainian user-facing
// strings. Backend doesn't localise (only emits codes), so the UI is on
// the hook for translation. Keep this list flat — the surrounding context
// usually says enough that we don't need per-route variants.

import { ApiError } from "./client";

const TELEGRAM_DOWN = "Сервіс тимчасово не відповідає. Спробуй за хвилину.";
const NEEDS_TG = "Відкрий додаток у Telegram, щоб продовжити.";
const SESSION_LOST = "Сесія завершилась. Закрий і відкрий додаток ще раз.";

export type ErrorContext = "feed" | "rsvp" | "onboarding" | "propose" | "default";

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

    // Backend infra.
    case "upstream":
    case "internal":
      return TELEGRAM_DOWN;
  }

  // Fall back to status code.
  if (e.status === 401) return SESSION_LOST;
  if (e.status === 403) return "Немає доступу.";
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
