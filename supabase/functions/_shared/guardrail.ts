// Post-processing guardrails for AI-generated copy. Caller decides what to do
// on violation: re-prompt, fall back to deterministic copy, or simply hide the line.

const BANNED_EN = /\b(hero|warrior|battle|veteran's choice|soldier|service member|honor)\b/i;
const BANNED_UK = /(героям слава|віддав найдорожче|незламн|нескорен|переможемо|віддавши себе)/i;

export type GuardrailHit = "banned_en" | "banned_uk" | "hallucinated_fact";

export type GuardrailResult = {
  ok: boolean;
  hits: GuardrailHit[];
  cleaned: string;
};

/**
 * Banned-words check + length cap. Returns the cleaned string and the violations found.
 */
export function checkCopy(
  text: string,
  opts: { maxLen?: number; allowedNames?: string[] } = {},
): GuardrailResult {
  const hits: GuardrailHit[] = [];
  if (BANNED_EN.test(text)) hits.push("banned_en");
  if (BANNED_UK.test(text)) hits.push("banned_uk");

  if (opts.allowedNames) {
    // Find Cyrillic-capitalised tokens (3+ chars) that look like first names and aren't whitelisted.
    const tokens = text.match(/\b[А-ЯҐІЇЄ][а-яґіїє'`-]{2,}\b/g) ?? [];
    const allowed = new Set(opts.allowedNames);
    const COMMON = new Set([
      // Cities + months + day names that shouldn't trigger
      "Київ",
      "Львів",
      "Дніпро",
      "Харків",
      "Одеса",
      "Вінниця",
      "Полтава",
      "Луцьк",
      "Рівне",
      "Завтра",
      "Сьогодні",
      "Понеділок",
      "Вівторок",
      "Середа",
      "Четвер",
      "П'ятниця",
      "Субота",
      "Неділя",
      "Січня",
      "Лютого",
      "Березня",
      "Квітня",
      "Травня",
      "Червня",
      "Липня",
      "Серпня",
      "Вересня",
      "Жовтня",
      "Листопада",
      "Грудня",
      "Гадяч",
      "Поруч",
    ]);
    for (const t of tokens) {
      if (allowed.has(t)) continue;
      if (COMMON.has(t)) continue;
      // Heuristic: a name is a single capitalized word that's not on the allow lists.
      // This is intentionally noisy; better to flag and re-prompt than miss a hallucination.
      if (t.length <= 4) continue; // skip prepositions like "Поки" etc.
      hits.push("hallucinated_fact");
      break;
    }
  }

  let cleaned = text.trim();
  if (opts.maxLen && cleaned.length > opts.maxLen) {
    const cut = cleaned.lastIndexOf(" ", opts.maxLen);
    cleaned = (cut > 0 ? cleaned.slice(0, cut) : cleaned.slice(0, opts.maxLen)) + "…";
  }

  return { ok: hits.length === 0, hits, cleaned };
}
