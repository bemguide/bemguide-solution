// gemini-copy — copy generator for four contexts:
//   why_this           one-line "чому саме це" for an event card  (≤90 chars)
//   reminder_24h       T-24h notification body                    (≤4 lines)
//   reminder_10m       T-10m notification body                    (≤2 lines)
//   description_clean  rewrite a wordy organizer description in plain Ukrainian
//
// All four are post-processed by the guardrail. On any failure caller
// gets {result: ""} and renders the bare facts instead.

import { handleCors } from "../_shared/cors.ts";
import { ok, err } from "../_shared/responses.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { geminiText, GEMINI_MODELS } from "../_shared/gemini.ts";
import { checkCopy } from "../_shared/guardrail.ts";

type Kind = "why_this" | "reminder_24h" | "reminder_10m" | "description_clean";

const PROMPTS: Record<Kind, string> = {
  why_this: `Ти пишеш одне коротке речення (максимум 12 слів) українською — рядок "чому саме це" для конкретної події у застосунку "Просвіт". На вході — профіль ветерана + одна подія.

Базуйся виключно на полях, які тобі передали. Якщо going_count=0 — не пиши "хтось іде". Якщо у going_names_visible немає імен — не вигадуй імена. Не вживай англіцизмів. Не вживай слів "герой", "захисник", "слава".

Приклади хороших рядків:
- "Безкоштовно, поруч (2 км), уже йде Олег з твого міста."
- "Жіноча група як ти просила, у Львові, в суботу."
- "Без сходів і з тихою кімнатою, як тобі важливо."

Поверни просто текст рядка. Без лапок, без преамбули.`,

  reminder_24h: `Напиши коротке (≤4 рядки) дружнє нагадування українською для ветерана про подію завтра.
Структура:
1. Привітання з іменем (без вигуків, без "доброго дня").
2. Назва події і час, простою мовою.
3. Адреса і коротка деталь "як знайти" (якщо є organizer_meet_at_note — використай).
4. Соціальне доказ: рядок social_proof, як є.

Без емоджі окрім ⏰ і 📍 на початку рядків (не обов'язково).
Без англійських слів. Без "буде круто".
Закінчи однією короткою фразою про автономію — "якщо плани змінилися — натисни 'не зможу', нагадування зніму".

Поверни просто текст. Без лапок, без преамбули.`,

  reminder_10m: `Напиши дуже коротке (≤2 рядки) повідомлення українською: старт за 10 хвилин.
Якщо в контексті є organizer_meet_at_note — використай дослівно. Якщо немає — простий рядок "Старт за 10 хвилин — «{title}». Якщо щось — пиши організатору: {phone}".

Без англійських слів. Без вигуків.
Поверни просто текст.`,

  description_clean: `Перепиши цей текст простою українською для ветерана.
Правила:
- Короткі речення.
- Жодних "запрошуємо Вас", "в рамках", "реалізації", "захід", "учасник".
- Замість "захід" — "зустріч" / "подія" / назва активності.
- Замість "учасник" — пряме звернення "ти" або просто опис ("ветерани, що приходять").
- Без англіцизмів, без емоджі, без вигуків.
- 2-4 короткі абзаци максимум.
- Якщо в оригіналі є важливі факти (час, місце, що приносити) — збережи їх дослівно.

Не додавай нічого, чого не було в оригіналі. Не приписуй цінностей чи обіцянок.
Поверни просто переписаний текст.`,
};

const MAX_LEN: Record<Kind, number> = {
  why_this: 100,
  reminder_24h: 600,
  reminder_10m: 220,
  description_clean: 1200,
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!isServiceCaller(req)) return err("unauthorized", 401);

  let body: { kind?: string; context?: unknown; allowed_names?: string[] };
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  const kind = body.kind as Kind | undefined;
  if (!kind || !(kind in PROMPTS)) return err("invalid kind");
  if (!body.context) return err("context required");

  try {
    const text = await geminiText(PROMPTS[kind], JSON.stringify(body.context), {
      model: GEMINI_MODELS.FAST,
      maxOutputTokens: kind === "description_clean" ? 2048 : 1024,
      temperature: kind === "description_clean" ? 0.3 : 0.5,
    });
    const guard = checkCopy(text, {
      maxLen: MAX_LEN[kind],
      allowedNames: body.allowed_names ?? [],
    });
    if (!guard.ok) {
      return ok({ text: "", hits: guard.hits, fallback: true });
    }
    return ok({ text: guard.cleaned });
  } catch (e) {
    console.warn(`gemini-copy(${kind}) failed:`, (e as Error).message);
    return ok({ text: "", fallback: true, error: (e as Error).message });
  }
});
