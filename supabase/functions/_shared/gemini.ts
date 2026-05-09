// Single Gemini client used by gemini-rank, gemini-parse-event, gemini-moderate, gemini-copy.
//
// - Models per spec: gemini-3.1-flash-lite-preview (fast/cheap; rank + copy)
//                    gemini-3-flash-preview        (more reasoning; moderate + parse)
// - Always responseMimeType: "application/json" + responseSchema for structured calls.
// - Retries: 2x on 5xx, 500ms+1000ms backoff. Throws on 4xx.
// - Callers handle the deterministic-fallback / guardrail logic on top.

import { env } from "./env.ts";

export const GEMINI_MODELS = {
  FAST: "gemini-3.1-flash-lite-preview",
  THINKING: "gemini-3-flash-preview",
} as const;

export type GeminiModel = (typeof GEMINI_MODELS)[keyof typeof GEMINI_MODELS];

export type GeminiOpts = {
  model?: GeminiModel;
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Raw text completion. Use `geminiJSON` for structured output. */
export async function geminiText(
  systemPrompt: string,
  userPrompt: string,
  opts: GeminiOpts = {},
): Promise<string> {
  const model = opts.model ?? GEMINI_MODELS.FAST;
  const apiKey = env.geminiKey();
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ role: "user", parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      temperature: opts.temperature ?? 0.4,
      ...(opts.maxOutputTokens ? { maxOutputTokens: opts.maxOutputTokens } : {}),
      ...(opts.responseSchema
        ? {
            responseMimeType: "application/json",
            responseSchema: opts.responseSchema,
          }
        : {}),
    },
  };

  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status >= 500) {
        lastErr = new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
      } else if (!res.ok) {
        throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 400)}`);
      } else {
        const json = (await res.json()) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (typeof text !== "string") {
          throw new Error(
            `Gemini: missing text in response: ${JSON.stringify(json).slice(0, 400)}`,
          );
        }
        return text;
      }
    } catch (e) {
      lastErr = e;
    }
    if (attempt < 2) await sleep(500 * (attempt + 1));
  }
  throw lastErr ?? new Error("Gemini call failed");
}

/** Structured JSON output. Validates parseability; caller validates the shape. */
export async function geminiJSON<T = unknown>(
  systemPrompt: string,
  userPrompt: string,
  opts: GeminiOpts & { responseSchema: Record<string, unknown> },
): Promise<T> {
  const text = await geminiText(systemPrompt, userPrompt, opts);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(
      `Gemini returned non-JSON despite responseSchema. Text head: ${text.slice(0, 200)}`,
      { cause: e },
    );
  }
}
