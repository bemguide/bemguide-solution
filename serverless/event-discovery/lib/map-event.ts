import { getOpenAI, LLM_MODEL } from "./openai-client.js";
import type { ClassifiedEvent, LlmMappedFields, Opportunity } from "./types.js";
import { geocode } from "./geocode.js";

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);
const DEFAULT_CITY = process.env.DEFAULT_CITY ?? "Дніпро";
const DEFAULT_OBLAST = process.env.DEFAULT_OBLAST ?? "Дніпропетровська";

const SCHEMA = {
  type: "object",
  properties: {
    start_at: { type: ["string", "null"] },
    duration_min: { type: ["integer", "null"] },
    interests: { type: "array", items: { type: "string" } },
    short_description: { type: "string" },
    description: { type: "string" },
    price_uah: { type: ["integer", "null"] },
    organizer_contact: { type: "string" },
  },
  required: [
    "start_at",
    "duration_min",
    "interests",
    "short_description",
    "description",
    "price_uah",
    "organizer_contact",
  ],
  additionalProperties: false,
};

function systemPrompt(today: string): string {
  return `Ти — мапер ветеранських подій у Supabase-схему opportunities.
Сьогодні: ${today} (Europe/Kyiv).

start_at ("YYYY-MM-DDTHH:MM:SS" або null):
- ongoing/recurring → null
- upcoming: бери starts_at якщо є, інакше парс із summary
- НЕ використовуй URL-слаги типу /2026/05/07/ — це дата публікації

duration_min (int хв або null): null якщо start_at=null. sport=60, education=120, recreation=null.

interests[]: [tag_id] + 1-3 ключових з summary.
short_description: ≤150 символів з summary.
description: ≤500 символів. Додай "Розклад: …" / "Пільга: …" / "Для: …" відповідно.
price_uah (int або null): 0 якщо явно безкоштовно. Парс суми. null якщо невідомо.
organizer_contact: "post_author · post_url" + телефон/email якщо є в summary.`;
}

async function mapOne(event: ClassifiedEvent): Promise<LlmMappedFields | null> {
  const today = new Date().toISOString().slice(0, 10);
  const userMessage = JSON.stringify({
    title: event.title,
    summary: event.post_text?.slice(0, 1500) ?? "",
    category: event.category,
    audience: event.audience,
    tag_id: event.tag_id,
    event_temporality: event.event_temporality,
    starts_at: event.starts_at,
    is_recurring: event.is_recurring,
    recurrence_text: event.recurrence_text,
    venue_text: event.venue_text,
    has_benefit: event.has_benefit,
    benefit_text: event.benefit_text,
    post_url: event.post_url,
    post_author: event.post_author,
  });

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: LLM_MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "opportunity_mapping",
          strict: true,
          schema: SCHEMA as Record<string, unknown>,
        },
      },
      messages: [
        { role: "system", content: systemPrompt(today) },
        { role: "user", content: userMessage },
      ],
    });
    const content = completion.choices[0]?.message.content;
    if (!content) return null;
    return JSON.parse(content) as LlmMappedFields;
  } catch (e) {
    console.error(`map failed for ${event.post_url}: ${(e as Error).message}`);
    return null;
  }
}

export async function buildOpportunities(
  events: ClassifiedEvent[],
): Promise<{ opp: Opportunity; post_url: string }[]> {
  const out: { opp: Opportunity; post_url: string }[] = [];

  for (let i = 0; i < events.length; i += CONCURRENCY) {
    const chunk = events.slice(i, i + CONCURRENCY);
    const llmResults = await Promise.all(chunk.map(mapOne));
    for (let j = 0; j < chunk.length; j++) {
      const e = chunk[j];
      const llm = llmResults[j];
      if (!llm) continue;
      const geo = await geocode(e.venue_text, DEFAULT_CITY);

      // DB constraint: if duration_min is set, start_at must be set too.
      const start_at = llm.start_at;
      const duration_min = start_at ? llm.duration_min : null;

      out.push({
        post_url: e.post_url,
        opp: {
          title: e.title.slice(0, 250),
          short_description: llm.short_description.slice(0, 250) || null,
          description: llm.description || null,
          photo_url: e.post_image_urls?.[0] ?? null,
          city: DEFAULT_CITY,
          oblast: DEFAULT_OBLAST,
          address: e.venue_text,
          location_lat: geo.lat,
          location_lng: geo.lng,
          start_at,
          duration_min,
          interests: llm.interests,
          price_uah: llm.price_uah,
          organizer_contact: llm.organizer_contact || null,
        },
      });
    }
  }

  return out;
}
