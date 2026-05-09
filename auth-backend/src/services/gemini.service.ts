import { GoogleGenerativeAI } from '@google/generative-ai';
import { env } from '../config/env.js';

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
