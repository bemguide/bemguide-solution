import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { env } from '../config/env.js';
import { supabaseAdmin } from '../config/supabase.js';

// Best-effort wrapper around Gemini for the /feed `ai_reason` field.
// Failure mode: log and return empty string. Never let a Gemini outage break
// the feed — `ai_reason` is decorative.
//
// Why a single call instead of one per opportunity: latency. With 30 cards
// in a feed response, individual roundtrips would dominate response time.
// We send one batched prompt and parse a structured array out.

interface ReasonInput {
  id: string;
  title: string;
  short_description?: string | null;
  city: string;
  interests: string[];
}

interface ReasonOutput {
  id: string;
  reason: string;
}

const SYSTEM_INSTRUCTION = `You generate 1-line empathetic Ukrainian-language reasons explaining why a specific event might fit a specific user. The voice is warm, low-pressure ("чому саме це для тебе"). Keep each reason to ≤80 characters. No emoji. No lists.`;

function getModel() {
  if (!env.GEMINI_API_KEY) return null;
  const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return client.getGenerativeModel({
    model: env.GEMINI_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
  });
}

export async function generateAiReasons(
  user: { city: string | null; interests: string[]; bio: string | null },
  opportunities: ReasonInput[],
): Promise<Record<string, string>> {
  if (opportunities.length === 0) return {};
  const model = getModel();
  if (!model) {
    // Unconfigured: every reason is the empty string. Frontend renders an
    // empty chip, per the contract's degraded fallback.
    return {};
  }

  const prompt =
    `User profile:\n` +
    `  city: ${user.city ?? 'unknown'}\n` +
    `  interests: ${user.interests.join(', ') || 'none'}\n` +
    `  bio: ${(user.bio ?? '').slice(0, 200)}\n\n` +
    `Opportunities (id | title | description | interests):\n` +
    opportunities
      .map(
        (o) => `  ${o.id} | ${o.title} | ${o.short_description ?? ''} | ${o.interests.join(',')}`,
      )
      .join('\n') +
    `\n\nReturn a JSON array of {id, reason} for each opportunity. Reasons in Ukrainian, ≤80 chars each. JSON only, no prose.`;

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.4,
        maxOutputTokens: 1024,
      },
    });
    const text = result.response.text();
    const parsed = JSON.parse(text) as ReasonOutput[];
    const map: Record<string, string> = {};
    for (const item of parsed) {
      if (typeof item?.id === 'string' && typeof item?.reason === 'string') {
        map[item.id] = item.reason.trim().slice(0, 200);
      }
    }
    return map;
  } catch (err) {
    // Swallow: ai_reason is decorative, don't fail the whole feed.
    // eslint-disable-next-line no-console
    console.warn('gemini ai_reason generation failed:', err);
    return {};
  }
}

// ---------------------------------------------------------------------------
// classifyInterest — controlled-vocabulary tagging
// ---------------------------------------------------------------------------
//
// Maps free-form profile text (event title/description, user bio/interests)
// onto a strict 22-value enum (matches public.classified_interest in the DB).
// Caller writes the result to <table>.classified_interest.
//
// Failure mode: return null. Caller leaves classified_at NULL so the hourly
// catch-up worker retries the row. This is critical for the
// "fire-and-forget on insert" pattern — we never want a Gemini outage to
// block row creation.

export const CLASSIFIED_INTEREST_VALUES = [
  // Physical / movement
  'physical_sport',
  'adaptive_sport',
  'equine_therapy',
  'outdoor_recreation',
  // Creative / cultural
  'art_therapy',
  'music',
  'creative_workshop',
  'cultural_event',
  // Health / therapy
  'rehabilitation',
  'recovery',
  'psychological_support',
  'medical_care',
  // Practical / life
  'legal_aid',
  'education',
  'career_development',
  'employment',
  'financial_aid',
  'discount_promotions',
  // Social
  'support_group',
  'community_meetup',
  'family_support',
  'women_support',
] as const;

export type ClassifiedInterest = (typeof CLASSIFIED_INTEREST_VALUES)[number];

const CLASSIFIED_INTEREST_SET = new Set<string>(CLASSIFIED_INTEREST_VALUES);

// Tag clusters used by the filtered feed (GET /feed?filter=…). Defined
// here, next to the enum, so the filter membership stays in sync if the
// vocabulary expands.
export const HEALTH_INTEREST_TAGS: readonly ClassifiedInterest[] = [
  'rehabilitation',
  'recovery',
  'psychological_support',
  'medical_care',
  'art_therapy',
  'equine_therapy',
] as const;

export const DISCOUNT_INTEREST_TAGS: readonly ClassifiedInterest[] = [
  'discount_promotions',
] as const;

export const CLASSIFIER_VERSION = 'v1';

export type ClassifyEntityType = 'opportunity' | 'opportunity_health' | 'user';

export interface ClassifyPayload {
  // Event surfaces
  title?: string | null;
  short_description?: string | null;
  description?: string | null;
  // User surface
  display_name?: string | null;
  bio?: string | null;
  // Both
  interests?: string[] | null;
}

export interface ClassifyResult {
  classified_interest: ClassifiedInterest[];
  confidence: number;
}

const CLASSIFY_SYSTEM_INSTRUCTION = `Ти — класифікатор інтересів для застосунку допомоги ветеранам.
Отримуєш профіль (користувача АБО подію АБО ресурс здоров'я) і маєш
повернути від 1 до 4 ТЕГІВ ІНТЕРЕСІВ із суворо фіксованого списку.

Правила:
1. Працюй ВИКЛЮЧНО з тегами зі списку нижче. Жодних інших слів.
2. Не використовуй теги-аудиторії (ветерани/військові/інвалідність) —
   це не інтереси, це цільова група. Вона зберігається в інших полях.
3. Знижки, акції, пільги, вигідні пропозиції — це повноцінна категорія
   discount_promotions. Вона існує для того, щоб користувач міг
   фільтрувати такі пропозиції окремо. Не уникай її, якщо контент
   справді про знижку.
4. confidence: 0.0–1.0. Низька = тег вгаданий по натяку; висока = у
   тексті прямо згадано тему тега.
5. Не повторюй теги. Не видумуй.

Список тегів:
- physical_sport, adaptive_sport, equine_therapy, outdoor_recreation
- art_therapy, music, creative_workshop, cultural_event
- rehabilitation, recovery, psychological_support, medical_care
- legal_aid, education, career_development, employment, financial_aid, discount_promotions
- support_group, community_meetup, family_support, women_support

Приклади:
- "Безкоштовні тренування для ветеранів у Дніпрі"
  → ["physical_sport"]; confidence 0.95.
- "Знижка 40% на суші у Дніпрі"
  → ["discount_promotions"]; confidence 0.95.
- "Знижка 15% на аналізи для військових"
  → ["discount_promotions", "medical_care"]; confidence 0.9.
- "Лялькотерапія для ветеранів"
  → ["art_therapy", "psychological_support"]; confidence 0.85.
- "Іпотерапія та уроки верхової їзди для ветеранів"
  → ["equine_therapy", "rehabilitation"]; confidence 0.9.`;

const CLASSIFY_RESPONSE_SCHEMA = {
  type: SchemaType.OBJECT,
  properties: {
    classified_interest: {
      type: SchemaType.ARRAY,
      items: { type: SchemaType.STRING, enum: [...CLASSIFIED_INTEREST_VALUES] },
      minItems: 1,
      maxItems: 4,
    },
    confidence: { type: SchemaType.NUMBER },
  },
  required: ['classified_interest', 'confidence'],
};

// Pinned model for classification: env.GEMINI_MODEL may default to a
// deprecated alias (gemini-2.0-flash is no longer available to new API
// access). Pin a current model here so the classifier is stable regardless
// of broader env config. Override via env.GEMINI_CLASSIFIER_MODEL if set.
const CLASSIFY_MODEL = process.env.GEMINI_CLASSIFIER_MODEL ?? 'gemini-2.5-flash';

function getClassifyModel() {
  if (!env.GEMINI_API_KEY) return null;
  const client = new GoogleGenerativeAI(env.GEMINI_API_KEY);
  return client.getGenerativeModel({
    model: CLASSIFY_MODEL,
    systemInstruction: CLASSIFY_SYSTEM_INSTRUCTION,
  });
}

// Pull the outermost balanced { ... } from a string, even when wrapped in
// prose or ```json fences. Returns null if no balanced object is found.
function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escape) escape = false;
      else if (ch === '\\') escape = true;
      else if (ch === '"') inString = false;
    } else if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

function buildClassifyPrompt(entityType: ClassifyEntityType, payload: ClassifyPayload): string {
  // Trim each text to bound prompt size; classifier needs gist, not full body.
  const t = (s: string | null | undefined, n = 400) => (s ?? '').toString().slice(0, n).trim();
  const interestsLine = (payload.interests ?? []).join(', ').slice(0, 200);

  if (entityType === 'user') {
    return [
      `Тип: користувач`,
      `display_name: ${t(payload.display_name, 80) || '—'}`,
      `bio: ${t(payload.bio, 400) || '—'}`,
      `вже зазначені інтереси (вільний текст): ${interestsLine || '—'}`,
    ].join('\n');
  }

  return [
    `Тип: ${entityType === 'opportunity_health' ? "ресурс здоров'я" : 'подія'}`,
    `title: ${t(payload.title, 200) || '—'}`,
    `short_description: ${t(payload.short_description, 400) || '—'}`,
    `description: ${t(payload.description, 800) || '—'}`,
    `existing_tags: ${interestsLine || '—'}`,
  ].join('\n');
}

export async function classifyInterest(
  entityType: ClassifyEntityType,
  payload: ClassifyPayload,
): Promise<ClassifyResult | null> {
  const model = getClassifyModel();
  if (!model) return null; // Unconfigured: caller skips, classified_at stays NULL.

  const prompt = buildClassifyPrompt(entityType, payload);

  try {
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        // Strict JSON schema — drops Gemini's tendency to invent extra tags.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        responseSchema: CLASSIFY_RESPONSE_SCHEMA as any,
        temperature: 0.2,
        // 256 was too tight: Gemini sometimes spends budget on a prose
        // preamble ("Here is the JSON…") and gets truncated before the
        // payload. 1024 is plenty for the strict {tags, confidence} object.
        maxOutputTokens: 1024,
      },
    });
    const text = result.response.text();
    // Defensive parse: even with responseMimeType=application/json, some
    // models occasionally prepend prose ("Here is the JSON: { ... }") or
    // wrap the body in ```json fences. Extract the outermost JSON object
    // before parsing.
    const jsonText = extractJsonObject(text) ?? text;
    const parsed = JSON.parse(jsonText) as { classified_interest?: unknown; confidence?: unknown };

    const rawTags = Array.isArray(parsed.classified_interest) ? parsed.classified_interest : [];
    // Validate against the enum even though responseSchema enforces it —
    // belt-and-suspenders for the rare case Gemini returns extras.
    const tags = Array.from(
      new Set(
        rawTags
          .filter((t): t is string => typeof t === 'string')
          .filter((t) => CLASSIFIED_INTEREST_SET.has(t)),
      ),
    ) as ClassifiedInterest[];
    if (tags.length === 0) return null; // Unusable result; let catch-up retry.

    const confidence =
      typeof parsed.confidence === 'number' && parsed.confidence >= 0 && parsed.confidence <= 1
        ? parsed.confidence
        : 0;

    return { classified_interest: tags, confidence };
  } catch (err) {
    // Best-effort: never let a classifier error break the caller. Logged so
    // the catch-up worker has signal but not noise.
    // eslint-disable-next-line no-console
    console.warn('gemini classifyInterest failed:', err);
    return null;
  }
}

// classifyAndPersist — classify a single row and write the result back.
// Used by:
//   - opportunities/users service post-insert/update hooks (fire-and-forget)
//   - scripts/backfill-classifier.ts (awaited)
// On classifier failure, leaves classified_at NULL so the hourly catch-up
// worker (or a backfill re-run) picks the row back up. Never throws.

export type ClassifyTable = 'opportunities' | 'opportunity_health' | 'users';

export async function classifyAndPersist(
  table: ClassifyTable,
  id: string,
  entityType: ClassifyEntityType,
  payload: ClassifyPayload,
): Promise<ClassifyResult | null> {
  const result = await classifyInterest(entityType, payload);
  if (!result) return null;
  const { error } = await supabaseAdmin
    .from(table)
    .update({
      classified_interest: result.classified_interest,
      classified_at: new Date().toISOString(),
      classifier_version: CLASSIFIER_VERSION,
      classifier_confidence: result.confidence,
    })
    .eq('id', id);
  if (error) {
    // Don't throw — caller is fire-and-forget. Surface the error in logs so
    // a missed write is at least debuggable.
    // eslint-disable-next-line no-console
    console.warn(`classifyAndPersist write failed (${table}/${id}):`, error.message);
    return null;
  }
  return result;
}
