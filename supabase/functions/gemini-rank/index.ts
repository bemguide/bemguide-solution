// gemini-rank — order candidate events for a specific veteran with per-event
// "чому саме це" reason. Deterministic fallback when AI is unavailable.
//
// POST { veteran_id, candidate_event_ids: string[] }  → 200 { ranked: [{event_id, score, reason}] }

import { handleCors } from "../_shared/cors.ts";
import { ok, err } from "../_shared/responses.ts";
import { isServiceCaller } from "../_shared/auth.ts";
import { geminiJSON, GEMINI_MODELS } from "../_shared/gemini.ts";
import { loadVeteran, loadEvents, loadAttendance, loadVeteranHistory } from "../_shared/db.ts";
import type { EventForRank, VeteranProfile } from "../_shared/db.ts";
import { distanceKm, hoursUntil } from "../_shared/distance.ts";
import { checkCopy } from "../_shared/guardrail.ts";

const SYSTEM_PROMPT = `Ти — ранжувальник подій для ветеранів у застосунку "Просвіт". Твоя задача — впорядкувати список подій під конкретного ветерана так, щоб ВЕРХНІ події з найбільшою ймовірністю реально допомогли цій людині.

Що враховуєш у пріоритеті (від важливого до менш):
1. Гео: що ближче — то краще (distance_km).
2. Інтереси: збіг categories з veteran.interests (повний > частковий).
3. Identity: якщо у ветерана identity_prefs = women_only — події з identity_tag=women_only йдуть у топ. Якщо identity_prefs = any — нейтрально.
4. Accessibility: якщо у ветерана є accessibility_flags, події без відповідних accessibility_flags ШТРАФУЄШ.
5. Часова доступність: події в найближчі 36 годин — у топ ("aha-секція"). Все що далі тижня — нижче.
6. Соціальне доказ: going_count > 3 додає бали; події з going_names_visible (особливо одне з імен — потенційно знайомий) — додатковий буст.
7. Минулий досвід: повторювані категорії з past_attended_categories — невеликий буст. Категорії з past_skipped — лёгкий штраф.
8. Ціна: безкоштовні (price_uah=0) пріоритетні; платні нижче, якщо інше рівне.

Що ти НЕ робиш:
- Не вигадуєш події. Працюєш ТІЛЬКИ зі списком, який тобі дали.
- Не змінюєш факти. Якщо going_count=0 — не пишеш "хтось іде".
- Не використовуєш англійські слова в reason.
- Не використовуєш слова "герой", "захисник", "слава", "переможець" в reason. Тон — спокійний.
- Не згадуєш accessibility_flags в reason інакше, ніж нейтральним фактом ("без сходів", "тиха кімната").

Для кожної події напиши \`reason\` — одне коротке речення (максимум 12 слів) українською, яке пояснює саме цьому ветерану, чому ця подія варта уваги. Базуйся виключно на полях, які тобі передали. Приклади хороших reason:
- "Безкоштовно, поруч (2 км), уже йде Олег з твого міста."
- "Жіноча група як ти просила, у Львові, в суботу."
- "Без сходів і з тихою кімнатою, як тобі важливо."
- "Перший раз — і нікого не питатимуть про статус."

Поверни JSON виключно за схемою. Без жодних пояснень.`;

const RANK_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          score: { type: "number" },
          reason: { type: "string" },
        },
        required: ["event_id", "score", "reason"],
      },
    },
  },
  required: ["ranked"],
};

type RankedItem = { event_id: string; score: number; reason: string };
type RankedOut = { ranked: RankedItem[] };

type RankInput = {
  veteran_id: string;
  candidate_event_ids: string[];
};

function parseInput(body: unknown): RankInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.veteran_id !== "string") return null;
  if (!Array.isArray(b.candidate_event_ids)) return null;
  if (!b.candidate_event_ids.every((x) => typeof x === "string")) return null;
  if (b.candidate_event_ids.length === 0) return null;
  return {
    veteran_id: b.veteran_id,
    candidate_event_ids: b.candidate_event_ids as string[],
  };
}

type ContextEvent = {
  id: string;
  title: string;
  city: string;
  categories: string[];
  identity_tag: string;
  accessibility_flags: string[];
  starts_in_hours: number;
  distance_km: number | null;
  going_count: number;
  going_names_visible: string[];
  price_uah: number;
};

function buildContextEvent(
  ev: EventForRank,
  veteranCity: string | null,
  attendance: { going_count: number; names_visible: string[] } | undefined,
): ContextEvent {
  return {
    id: ev.id,
    title: ev.title,
    city: ev.city,
    categories: ev.categories,
    identity_tag: ev.identity_tag,
    accessibility_flags: ev.accessibility_flags,
    starts_in_hours: hoursUntil(ev.start_at),
    distance_km: distanceKm(veteranCity, ev.location_lat, ev.location_lng),
    going_count: attendance?.going_count ?? 0,
    going_names_visible: attendance?.names_visible ?? [],
    price_uah: ev.price_uah,
  };
}

function deterministicFallback(events: ContextEvent[]): RankedItem[] {
  return [...events]
    .sort((a, b) => {
      const da = a.distance_km ?? 9999;
      const db = b.distance_km ?? 9999;
      if (da !== db) return da - db;
      if (a.starts_in_hours !== b.starts_in_hours) return a.starts_in_hours - b.starts_in_hours;
      if (a.going_count !== b.going_count) return b.going_count - a.going_count;
      return a.price_uah - b.price_uah;
    })
    .map((e, i) => ({ event_id: e.id, score: 1 - i / events.length, reason: "" }));
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

  // Load context
  let veteran: VeteranProfile | null;
  let events: EventForRank[];
  let attendance: Map<string, { going_count: number; names_visible: string[] }>;
  let history: { attended: string[]; skipped: string[] };
  try {
    [veteran, events, attendance, history] = await Promise.all([
      loadVeteran(input.veteran_id),
      loadEvents(input.candidate_event_ids),
      loadAttendance(input.candidate_event_ids),
      loadVeteranHistory(input.veteran_id),
    ]);
  } catch (e) {
    return err(`db error: ${(e as Error).message}`, 500);
  }

  if (!veteran) return err("veteran not found", 404);
  if (events.length === 0) return ok({ ranked: [] });

  const contextEvents = events.map((ev) =>
    buildContextEvent(ev, veteran!.city, attendance.get(ev.id)),
  );

  const userPayload = {
    veteran: {
      city: veteran.city,
      interests: veteran.interests,
      accessibility_flags: veteran.accessibility_flags,
      identity_prefs: veteran.identity_prefs,
      comfort_notes: veteran.comfort_notes,
      past_attended_categories: history.attended,
      past_skipped_categories: history.skipped,
    },
    events: contextEvents,
  };

  // Try Gemini; on any failure, deterministic fallback.
  try {
    const out = await geminiJSON<RankedOut>(SYSTEM_PROMPT, JSON.stringify(userPayload), {
      model: GEMINI_MODELS.FAST,
      responseSchema: RANK_RESPONSE_SCHEMA,
      maxOutputTokens: 2048,
      temperature: 0.4,
    });

    if (!out?.ranked || !Array.isArray(out.ranked)) {
      throw new Error("missing ranked array");
    }

    const allowedIds = new Set(events.map((e) => e.id));
    const allowedNames = new Set<string>();
    for (const ev of contextEvents) for (const n of ev.going_names_visible) allowedNames.add(n);

    const cleaned: RankedItem[] = [];
    for (const item of out.ranked) {
      if (!allowedIds.has(item.event_id)) continue;
      const guardCheck = checkCopy(item.reason ?? "", {
        maxLen: 100,
        allowedNames: [...allowedNames],
      });
      cleaned.push({
        event_id: item.event_id,
        score: typeof item.score === "number" ? item.score : 0,
        reason: guardCheck.ok ? guardCheck.cleaned : "",
      });
    }

    // Append any missing events at the bottom (Gemini might drop some).
    for (const id of allowedIds) {
      if (!cleaned.find((c) => c.event_id === id)) {
        cleaned.push({ event_id: id, score: 0, reason: "" });
      }
    }

    return ok({ ranked: cleaned, fallback: false });
  } catch (e) {
    console.warn("gemini-rank fell back:", (e as Error).message);
    return ok({ ranked: deterministicFallback(contextEvents), fallback: true });
  }
});
