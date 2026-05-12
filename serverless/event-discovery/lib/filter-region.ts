import { getOpenAI, LLM_MODEL } from "./openai-client.js";
import type { ClassifiedEvent, Region } from "./types.js";

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 5);

const SCHEMA = {
  type: "object",
  properties: {
    is_in_region: { type: "boolean" },
    confidence: { type: "number" },
    reason: { type: "string" },
  },
  required: ["is_in_region", "confidence", "reason"],
  additionalProperties: false,
};

function systemPrompt(region: Region): string {
  return `Ти — строгий гео-фільтр. Визнач чи подія САМЕ у місті ${region.name_uk}.

ЗБЕРІГАЙ (is_in_region=true):
- Подія фізично у місті ${region.name_uk}
- Програма/сервіс розташовані у ${region.name_uk}, орієнтовані на жителів міста
- Регулярна активність у місті

ВІДКИДАЙ (is_in_region=false):
- Інші українські міста
- Сателітні міста ${region.oblast_uk} області, що НЕ ${region.name_uk}
- Загальні згадки області без конкретного посилання на місто
- Закордонні події
- Загальнонаціональні програми без явної прив'язки до ${region.name_uk}
- Поїздки З ${region.name_uk} в інше місце (місцем події є інше місто)

confidence: 0.0-1.0. reason: 1 коротке речення українською.`;
}

async function filterOne(
  event: ClassifiedEvent,
  region: Region,
): Promise<{ event: ClassifiedEvent; keep: boolean; reason: string } | null> {
  const userMessage = [
    `TITLE: ${event.title}`,
    `CITY (попередньо): ${event.city ?? "—"}`,
    `VENUE: ${event.venue_text ?? "—"}`,
    `SUMMARY: ${event.post_text?.slice(0, 1000) ?? "—"}`,
  ].join("\n");

  try {
    const completion = await getOpenAI().chat.completions.create({
      model: LLM_MODEL,
      temperature: 0,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "region_filter",
          strict: true,
          schema: SCHEMA as Record<string, unknown>,
        },
      },
      messages: [
        { role: "system", content: systemPrompt(region) },
        { role: "user", content: userMessage },
      ],
    });
    const content = completion.choices[0]?.message.content;
    if (!content) return null;
    const v = JSON.parse(content) as {
      is_in_region: boolean;
      confidence: number;
      reason: string;
    };
    return { event, keep: v.is_in_region, reason: v.reason };
  } catch (e) {
    console.error(`filter failed for ${event.post_url}: ${(e as Error).message}`);
    return null;
  }
}

export async function filterByRegion(
  events: ClassifiedEvent[],
  region: Region,
): Promise<ClassifiedEvent[]> {
  const out: ClassifiedEvent[] = [];
  for (let i = 0; i < events.length; i += CONCURRENCY) {
    const chunk = events.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map((e) => filterOne(e, region)));
    for (const r of results) if (r?.keep) out.push(r.event);
  }
  return out;
}
