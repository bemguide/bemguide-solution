// gemini-moderate — pre-screen score for the admin moderation inbox.
//
// POST { event_id }  → 200 { score, flags, suggested_edits, sub_scores }
// Loads the event from DB (status='pending' or 'draft'), asks Gemini for a 0..1
// score across 4 dimensions + red flags + suggested edits. Stores nothing —
// caller persists into events.ai_screen_score / events.ai_screen_notes.

import { handleCors } from "../_shared/cors.ts";
import { ok, err } from "../_shared/responses.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { geminiJSON, GEMINI_MODELS } from "../_shared/gemini.ts";
import { adminClient } from "../_shared/supabase.ts";

const SYSTEM_PROMPT = `Ти — допоміжний модератор подій для ветеранів. Твоя робота — НЕ ухвалювати рішення, а допомогти людині-модератору швидко зрозуміти, на що звернути увагу.

Оціни подію за такими ознаками:
1. relevance: чи виглядає це як подія для ветеранів / спільноти / реабілітації / дозвілля? (0-1)
2. tone_appropriate: чи мова поваги, без патерналізму, без мілітарних кліше, без жертовності? (0-1)
3. accessibility_honest: чи чесно описана доступність — або зазначено явно "не адаптовано"? (0-1)
4. contact_real: чи виглядають контакти реальними (Telegram handle, телефон у коректному форматі)? (0-1)
5. red_flags: масив рядків з конкретними проблемами, кожна — одне речення. Можливі категорії:
   - "scam": запит грошей, "заробіток", криптовалюти, MLM
   - "medical": обіцянки лікування, психологія без ліцензії, "виліковуємо ПТСР"
   - "political": агітація за партію/кандидата
   - "weapons": зброя, тренування зі зброєю не у військовому контексті
   - "alcohol_centric": подія цілком навколо алкоголю/казино
   - "vague": настільки розмита, що неможливо зрозуміти, що це
   - "stolen_content": здається копіпастом з іншого джерела
6. suggested_edits: масив 0-3 коротких порад модератору ("уточнити час", "перевірити, що це не платно", "запросити фото організатора").

Не вигадуй проблем там, де їх немає. Якщо все нормально — red_flags порожній.

Поверни JSON за схемою.`;

const MODERATE_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    relevance: { type: "number" },
    tone_appropriate: { type: "number" },
    accessibility_honest: { type: "number" },
    contact_real: { type: "number" },
    red_flags: { type: "array", items: { type: "string" } },
    suggested_edits: { type: "array", items: { type: "string" } },
    overall_score: { type: "number" },
  },
  required: [
    "relevance",
    "tone_appropriate",
    "accessibility_honest",
    "contact_real",
    "red_flags",
    "suggested_edits",
    "overall_score",
  ],
};

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  if (req.method !== "POST") return err("method not allowed", 405);
  if (!isServiceCaller(req)) return err("unauthorized", 401);

  let body: { event_id?: string };
  try {
    body = await req.json();
  } catch {
    return err("invalid JSON body");
  }
  if (typeof body.event_id !== "string") return err("event_id required");

  const supabase = adminClient();
  const { data: event, error } = await supabase
    .from("events")
    .select(
      "id, slug, title, short_description, description, city, address, start_at, duration_min, categories, identity_tag, accessibility_flags, honest_absences, price_uah, organizer_contact, source",
    )
    .eq("id", body.event_id)
    .maybeSingle();
  if (error) return err(`db error: ${error.message}`, 500);
  if (!event) return err("event not found", 404);

  try {
    const out = await geminiJSON(SYSTEM_PROMPT, JSON.stringify(event), {
      model: GEMINI_MODELS.THINKING,
      responseSchema: MODERATE_RESPONSE_SCHEMA,
      maxOutputTokens: 2048,
      temperature: 0.2,
    });
    return ok({ result: out });
  } catch (e) {
    // On AI failure, return a neutral score so admin still gets the event in inbox.
    console.warn("gemini-moderate fell back:", (e as Error).message);
    return ok({
      result: {
        relevance: 0.5,
        tone_appropriate: 0.5,
        accessibility_honest: 0.5,
        contact_real: 0.5,
        red_flags: [],
        suggested_edits: ["AI score unavailable — review manually"],
        overall_score: 0.5,
      },
      fallback: true,
    });
  }
});
