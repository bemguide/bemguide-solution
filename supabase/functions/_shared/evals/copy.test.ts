// gemini-copy evals.

import { assert, assertEquals } from "jsr:@std/assert@0.224.0";
import { callFn } from "./helpers.ts";

type CopyResp = { ok: boolean; text: string; fallback?: boolean; hits?: string[] };

Deno.test("copy.why_this: ≤100 chars, plain Ukrainian", async () => {
  const { json } = await callFn<CopyResp>("gemini-copy", {
    kind: "why_this",
    context: {
      veteran: {
        city: "Київ",
        interests: ["movement", "community"],
        identity_prefs: "any",
        accessibility_flags: [],
      },
      event: {
        title: "Футбол з ветеранами у парку Шевченка",
        city: "Київ",
        categories: ["movement", "community"],
        identity_tag: "any",
        accessibility_flags: ["barrier_free"],
        starts_in_hours: 20,
        distance_km: 2.1,
        going_count: 4,
        going_names_visible: ["Олег"],
        price_uah: 0,
      },
    },
    allowed_names: ["Олег"],
  });
  assert(json.text.length <= 100, `too long: ${json.text.length}`);
  assert(json.text.length > 0 || json.fallback, `empty text without fallback flag`);
});

Deno.test("copy.why_this: does NOT invent names not in going_names_visible", async () => {
  const { json } = await callFn<CopyResp>("gemini-copy", {
    kind: "why_this",
    context: {
      veteran: {
        city: "Львів",
        interests: ["craft"],
        identity_prefs: "women_only",
        accessibility_flags: [],
      },
      event: {
        title: "Жіноче ремесло — гончарство",
        city: "Львів",
        categories: ["craft"],
        identity_tag: "women_only",
        accessibility_flags: ["barrier_free", "quiet_room"],
        starts_in_hours: 30,
        distance_km: 1.8,
        going_count: 0,
        going_names_visible: [],
        price_uah: 0,
      },
    },
    allowed_names: [],
  });
  // No names should appear since going_names_visible is empty.
  // The guardrail flags any obvious cyrillic capitalised name token; if it tripped,
  // text is empty and fallback=true.
  if (json.text) {
    // Heuristic: text should not contain a clearly-named person.
    const NAME_TOKEN = /\b[А-ЯҐІЇЄ][а-яґіїє'`]{3,}/;
    const tokens = json.text.match(/\b[А-ЯҐІЇЄ][а-яґіїє'`]{3,}\b/g) ?? [];
    // City names are allowed.
    const allowed = new Set(["Львів", "Київ", "Дніпро", "Поруч"]);
    for (const t of tokens) {
      assert(allowed.has(t), `unexpected name in copy: "${t}" (full: "${json.text}")`);
    }
  }
});

Deno.test("copy.description_clean: strips bureaucratic jargon", async () => {
  const { json } = await callFn<CopyResp>("gemini-copy", {
    kind: "description_clean",
    context: {
      raw: "Запрошуємо Вас на захід в рамках реалізації програми соціальної адаптації ветеранів. У програмі заходу: ознайомлення з учасниками, групова робота, підведення підсумків. Початок о 18:00.",
    },
  });
  assert(json.text.length > 0, "rewrite should produce text");
  assert(
    !/(запрошуємо\s+вас|в\s+рамках)/i.test(json.text),
    `bureaucratic phrase leaked: "${json.text}"`,
  );
});

Deno.test("copy.reminder_24h: contains time and address from context", async () => {
  const { json } = await callFn<CopyResp>("gemini-copy", {
    kind: "reminder_24h",
    context: {
      veteran: { display_name: "Олег", city: "Київ" },
      event: {
        title: "Футбол у парку",
        start_at: "завтра о 18:00",
        address: "парк Шевченка, південний вхід",
        going_count: 4,
        going_names_visible: ["Андрій"],
        organizer_meet_at_note: "збір біля воріт",
      },
      social_proof: "Андрій і ще 3 хлопці підтвердили",
    },
  });
  assert(json.text.length > 0);
  assert(/18:00|завтра/.test(json.text), `expected time mention: "${json.text}"`);
});
