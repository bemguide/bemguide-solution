// gemini-moderate evals.

import { assert, assertEquals } from "jsr:@std/assert@0.224.0";
import { callFn, admin } from "./helpers.ts";

type ModResp = {
  ok: boolean;
  result: {
    relevance: number;
    tone_appropriate: number;
    accessibility_honest: number;
    contact_real: number;
    overall_score: number;
    red_flags: string[];
    suggested_edits: string[];
  };
};

async function makeTempEvent(attrs: {
  title: string;
  description: string;
  city: string;
  address?: string;
  organizer_contact?: string;
  price_uah?: number;
  categories?: string[];
}): Promise<string> {
  const future = new Date();
  future.setDate(future.getDate() + 14);
  const startIso = `${future.toISOString().slice(0, 10)}T18:00:00+03:00`;
  const { data, error } = await admin()
    .from("events")
    .insert({
      slug: `evaltest-${crypto.randomUUID().slice(0, 8)}`,
      title: attrs.title,
      description: attrs.description,
      short_description: attrs.description.slice(0, 80),
      city: attrs.city,
      address: attrs.address ?? "вул. Шевченка 12",
      start_at: startIso,
      duration_min: 60,
      categories: attrs.categories ?? ["community"],
      identity_tag: "any",
      accessibility_flags: [],
      price_uah: attrs.price_uah ?? 0,
      organizer_contact: attrs.organizer_contact ?? "@evaltest_org • +380440000099",
      source: "veteran_submission" as const,
      status: "pending" as const,
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

async function deleteEvent(id: string) {
  await admin().from("events").delete().eq("id", id);
}

Deno.test("moderate: clean wholesome event scores high (relevance ≥0.7)", async () => {
  const id = await makeTempEvent({
    title: "Спільне чаювання у бібліотеці",
    description:
      "Невелика група ветеранів збирається у тихій кімнаті бібліотеки. Чай, прості розмови, без зобов'язань. Веде Олена, працівниця бібліотеки.",
    city: "Київ",
    address: "вул. Турівська 13, бібліотека імені Кобилянської",
  });
  try {
    const { status, json } = await callFn<ModResp>("gemini-moderate", { event_id: id });
    assertEquals(status, 200);
    assert(json.result.relevance >= 0.7, `relevance too low: ${json.result.relevance}`);
    assert(json.result.tone_appropriate >= 0.7);
    // We allow zero or very few minor suggestions; assert no critical red flags.
    const critical = json.result.red_flags.filter((f) =>
      /scam|medical|political|weapons|alcohol_centric/i.test(f),
    );
    assertEquals(critical.length, 0, `unexpected critical flags: ${critical.join(", ")}`);
  } finally {
    await deleteEvent(id);
  }
});

Deno.test("moderate: scammy money-asking event raises a red flag", async () => {
  const id = await makeTempEvent({
    title: "Заробіток для ветеранів — пасивний дохід $1000/міс",
    description:
      "Гарантований дохід $500-1000 на місяць. Приходь, реєструйся, заробляй. Реферальна програма дасть тобі швидкий старт. Інвестиція $50.",
    city: "Київ",
    price_uah: 50,
  });
  try {
    const { json } = await callFn<ModResp>("gemini-moderate", { event_id: id });
    assert(json.result.red_flags.length > 0, "expected at least one red_flag for scammy event");
    assert(json.result.overall_score < 0.6, `overall_score too high: ${json.result.overall_score}`);
  } finally {
    await deleteEvent(id);
  }
});

Deno.test("moderate: overall_score is between 0 and 1", async () => {
  const id = await makeTempEvent({
    title: "Прогулянка у парку",
    description: "Тиха прогулянка для ветеранів. Збір біля входу.",
    city: "Львів",
  });
  try {
    const { json } = await callFn<ModResp>("gemini-moderate", { event_id: id });
    assert(json.result.overall_score >= 0 && json.result.overall_score <= 1);
  } finally {
    await deleteEvent(id);
  }
});
