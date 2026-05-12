import { getOpenAI, LLM_MODEL } from "./openai-client.js";
import type { Candidate, ClassifiedEvent } from "./types.js";

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);
const MIN_CONFIDENCE = Number(process.env.MIN_CONFIDENCE ?? 0.5);

const SCHEMA = {
  type: "object",
  properties: {
    is_event: { type: "boolean" },
    event_temporality: {
      type: "string",
      enum: ["upcoming", "recurring", "ongoing", "past", "not_event"],
    },
    title: { type: "string" },
    summary: { type: "string" },
    category: {
      type: "string",
      enum: [
        "sport",
        "adaptive_sport",
        "recreation",
        "nature",
        "creative",
        "community",
        "support_group",
        "family",
        "education",
        "benefit",
      ],
    },
    audience: {
      type: "string",
      enum: [
        "veteran_only",
        "veteran_priority",
        "veteran_benefit",
        "community_open",
        "not_relevant",
      ],
    },
    starts_at: { type: ["string", "null"] },
    ends_at: { type: ["string", "null"] },
    is_recurring: { type: "boolean" },
    recurrence_text: { type: ["string", "null"] },
    venue_text: { type: ["string", "null"] },
    city: { type: ["string", "null"] },
    has_benefit: { type: "boolean" },
    benefit_text: { type: ["string", "null"] },
    llm_confidence: { type: "number" },
    llm_relevance_reason: { type: "string" },
  },
  required: [
    "is_event",
    "event_temporality",
    "title",
    "summary",
    "category",
    "audience",
    "starts_at",
    "ends_at",
    "is_recurring",
    "recurrence_text",
    "venue_text",
    "city",
    "has_benefit",
    "benefit_text",
    "llm_confidence",
    "llm_relevance_reason",
  ],
  additionalProperties: false,
};

function systemPrompt(today: string): string {
  return `Ти — класифікатор постів про ветеранів.
Сьогодні: ${today}.

ЗАВДАННЯ: визначити чи цей пост — анонс МАЙБУТНЬОЇ або ДІЮЧОЇ події/активності/програми/пільги, релевантної ветеранам.

ВІДКИДАЙ (is_event=false): новини про вже відбулі події; підсумки/звіти; реклама без анонсу; політичні новини; минулі дати.

ЗБЕРІГАЙ (is_event=true): майбутні зустрічі/тренування/курси з датою; регулярні активності; постійно діючі програми; набори; знижки/пільги для ветеранів.

audience: veteran_only / veteran_priority / veteran_benefit / community_open / not_relevant.
category: sport, adaptive_sport, recreation, nature, creative, community, support_group, family, education, benefit.

Дата: спробуй розпарсити "цієї суботи" / "12 травня" в ISO 8601 (Europe/Kyiv) відносно ${today}. Якщо неоднозначно — null.

llm_confidence: 0.0-1.0. llm_relevance_reason: 1 коротке речення українською.`;
}

async function classifyOne(
  candidate: Candidate,
): Promise<ClassifiedEvent | null> {
  const today = new Date().toISOString().slice(0, 10);
  const userMessage = [
    `Автор: ${candidate.post_author ?? "(невідомо)"}`,
    `Час публікації: ${candidate.time_text ?? "(невідомо)"}`,
    `Регіон скрейпу: ${candidate.region_id}`,
    `Тег скрейпу: ${candidate.tag_id}`,
    "",
    "ТЕКСТ:",
    (candidate.post_text ?? "").slice(0, 4000),
  ].join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: LLM_MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "event_classification",
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
    const llm = JSON.parse(content);
    return { ...candidate, ...llm } as ClassifiedEvent;
  } catch (e) {
    console.error(`classify failed for ${candidate.post_url}: ${(e as Error).message}`);
    return null;
  }
}

export function isKept(e: ClassifiedEvent): boolean {
  return (
    e.is_event &&
    (e.event_temporality === "upcoming" ||
      e.event_temporality === "recurring" ||
      e.event_temporality === "ongoing") &&
    e.audience !== "not_relevant" &&
    e.llm_confidence >= MIN_CONFIDENCE
  );
}

export async function classifyAll(
  candidates: Candidate[],
): Promise<ClassifiedEvent[]> {
  const out: ClassifiedEvent[] = [];
  for (let i = 0; i < candidates.length; i += CONCURRENCY) {
    const chunk = candidates.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(classifyOne));
    for (const r of results) if (r) out.push(r);
  }
  return out;
}
