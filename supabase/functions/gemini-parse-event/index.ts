// gemini-parse-event — turn free Ukrainian text into a structured EventDraft + clarifying questions.
//
// POST { raw_text, veteran_city?, current_date?, prior_user_answers? }
//   → 200 { parsed, missing, clarifying_questions, confidence }
//
// Used by /m/propose and bot /newevent. After 0–3 clarifying rounds the caller
// shows a preview card and asks the veteran to confirm.

import { handleCors } from "../_shared/cors.ts";
import { ok, err } from "../_shared/responses.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { geminiJSON, GEMINI_MODELS } from "../_shared/gemini.ts";

const SYSTEM_PROMPT = `Ти допомагаєш ветерану описати свою подію, яку він хоче провести для інших ветеранів. На вході — вільний український текст. На виході — структуровані поля + список того, чого бракує для публікації.

Твоя задача — РОЗПАРСИТИ, а не вигадати. Якщо у тексті немає інформації про якесь поле — НЕ заповнюй його, додай у missing.

Поля, які треба витягнути:
- title: коротка назва (макс 80 символів). Якщо назви явно немає — згенеруй коротку, нейтральну ("Шахи у бібліотеці").
- description: 2-3 речення простою мовою про що подія, без юридичної мови, без англіцизмів.
- city: назва міста. Якщо у тексті немає — використай veteran_city.
- address: адреса як є в тексті (наприклад, "бібліотека на Лесі Українки").
- start_at_iso: ISO 8601 з часовою зоною Europe/Kyiv. Розв'язуй відносні дати ("в суботу", "завтра", "наступного тижня") відносно current_date.
- duration_min: 60 за замовчуванням, якщо не вказано інше.
- categories: масив з [movement, learning, community, craft, volunteering, walks, reading, family]. Виберися 1-2 найрелевантніші.
- identity_tag: any | women_only | men_only | mixed_with_women_emphasis | family_friendly. За замовчуванням any.
- accessibility_flags: масив з [barrier_free, no_stairs, quiet_room, no_alcohol, sign_language, audio_described, sensory_friendly, parking_disabled, service_animal_ok]. ПОРОЖНІЙ за замовчуванням — не вгадуй.
- price_uah: ціле число. 0 якщо "безкоштовно" або не вказано.
- max_people: число або null.

clarifying_questions: 0-3 коротких уточнюючих запитання українською, які треба поставити ветерану, ЯКЩО з тексту неясно щось критичне для модерації або для пошуку (наприклад, "адаптовано для людей з обмеженою рухливістю?", "чи буде алкоголь?", "як зв'язатися з тобою — Telegram чи телефон?").

Стиль уточнень:
- Один рядок, без преамбули.
- Не паттерналізм. Не "ласкаво просимо".
- Прямий, поважний тон.

Поверни JSON виключно за схемою. Жодних пояснень поза JSON.`;

const PARSE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    parsed: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        city: { type: "string" },
        address: { type: "string" },
        start_at_iso: { type: "string", nullable: true },
        duration_min: { type: "integer" },
        categories: { type: "array", items: { type: "string" } },
        identity_tag: { type: "string" },
        accessibility_flags: { type: "array", items: { type: "string" } },
        price_uah: { type: "integer" },
        max_people: { type: "integer", nullable: true },
      },
      required: [
        "title",
        "description",
        "city",
        "duration_min",
        "categories",
        "identity_tag",
        "accessibility_flags",
        "price_uah",
      ],
    },
    missing: { type: "array", items: { type: "string" } },
    clarifying_questions: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  required: ["parsed", "missing", "clarifying_questions", "confidence"],
};

type ParseInput = {
  raw_text: string;
  veteran_city?: string;
  current_date?: string;
  prior_user_answers?: { question: string; answer: string }[];
};

function parseInput(body: unknown): ParseInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.raw_text !== "string" || !b.raw_text.trim()) return null;
  return {
    raw_text: b.raw_text,
    veteran_city: typeof b.veteran_city === "string" ? b.veteran_city : undefined,
    current_date: typeof b.current_date === "string" ? b.current_date : undefined,
    prior_user_answers: Array.isArray(b.prior_user_answers)
      ? (b.prior_user_answers as { question: string; answer: string }[])
      : undefined,
  };
}

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!isServiceCaller(req)) return err("unauthorized", 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  const input = parseInput(body);
  if (!input) return err("invalid input shape");

  const today = input.current_date ?? new Date().toISOString().slice(0, 10);
  const userPayload = {
    raw_text: input.raw_text,
    veteran_city: input.veteran_city ?? null,
    current_date: today,
    timezone: "Europe/Kyiv",
    prior_user_answers: input.prior_user_answers ?? [],
  };

  try {
    const out = await geminiJSON(SYSTEM_PROMPT, JSON.stringify(userPayload), {
      model: GEMINI_MODELS.THINKING,
      responseSchema: PARSE_RESPONSE_SCHEMA,
      maxOutputTokens: 4096,
      temperature: 0.3,
    });
    return ok({ result: out });
  } catch (e) {
    return err(`parse failed: ${(e as Error).message}`, 502);
  }
});
