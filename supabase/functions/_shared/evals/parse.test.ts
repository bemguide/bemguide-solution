// gemini-parse-event evals.

import { assert, assertEquals } from "jsr:@std/assert@0.224.0";
import { callFn } from "./helpers.ts";

type ParseResp = {
  ok: boolean;
  result: {
    parsed: {
      title: string;
      city: string;
      address?: string;
      start_at_iso?: string | null;
      categories: string[];
      identity_tag: string;
      accessibility_flags: string[];
      price_uah: number;
      duration_min: number;
      max_people?: number | null;
    };
    missing: string[];
    clarifying_questions: string[];
    confidence: number;
  };
};

Deno.test("parse: extracts city, time, address from rich input", async () => {
  const { status, json } = await callFn<ParseResp>("gemini-parse-event", {
    raw_text:
      "хочу зробити шахи в суботу о 14:00 у Гадячі, бібліотека на Лесі Українки, до 10 людей, безкоштовно",
    veteran_city: "Гадяч",
    current_date: "2026-05-09",
  });
  assertEquals(status, 200);
  const p = json.result.parsed;
  assert(p.title.length > 0, "title required");
  assertEquals(p.city, "Гадяч");
  assertEquals(p.price_uah, 0);
  assert(/Лесі Українки/i.test(p.address ?? ""), `address should mention street: ${p.address}`);
});

Deno.test("parse: women_only is inferred from explicit phrasing", async () => {
  const { json } = await callFn<ParseResp>("gemini-parse-event", {
    raw_text: "жіночі посиденьки з вишивкою у бібліотеці у Львові, наступної п'ятниці о 18",
    veteran_city: "Львів",
    current_date: "2026-05-09",
  });
  const p = json.result.parsed;
  assertEquals(p.identity_tag, "women_only");
  assert(p.categories.includes("craft") || p.categories.includes("community"));
});

Deno.test("parse: missing critical info surfaces clarifying questions", async () => {
  const { json } = await callFn<ParseResp>("gemini-parse-event", {
    raw_text: "хочу провести зустріч",
    veteran_city: "Київ",
    current_date: "2026-05-09",
  });
  // With almost no info, parser should produce missing fields and clarifying questions.
  assert(
    json.result.missing.length > 0 || json.result.clarifying_questions.length > 0,
    "expected missing or clarifying_questions for vague input",
  );
});

Deno.test("parse: defaults price_uah=0 when not mentioned", async () => {
  const { json } = await callFn<ParseResp>("gemini-parse-event", {
    raw_text: "пробіжка у парку Шевченка завтра о 8 ранку",
    veteran_city: "Дніпро",
    current_date: "2026-05-09",
  });
  assertEquals(json.result.parsed.price_uah, 0);
});
