import type { Candidate, Region } from "./types.js";
import { TAGS } from "./tags.js";

const TIME_RANGE = (process.env.TIME_RANGE ?? "day") as
  | "day"
  | "week"
  | "month"
  | "year";
const SEARCH_DEPTH = (process.env.SEARCH_DEPTH ?? "advanced") as
  | "basic"
  | "advanced";
const MAX_RESULTS = Number(process.env.MAX_RESULTS ?? 20);

type TavilyResult = {
  title: string;
  url: string;
  content: string;
  raw_content?: string | null;
  published_date?: string;
  score: number;
};

async function tavilySearch(query: string): Promise<TavilyResult[]> {
  const resp = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: SEARCH_DEPTH,
      max_results: MAX_RESULTS,
      include_raw_content: true,
      time_range: TIME_RANGE,
      country: "ukraine",
      topic: "general",
    }),
  });
  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Tavily HTTP ${resp.status}: ${body.slice(0, 200)}`);
  }
  const data = (await resp.json()) as { results: TavilyResult[] };
  return data.results ?? [];
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export async function discoverCandidates(region: Region): Promise<Candidate[]> {
  const queries: { tag: string; keyword: string; query: string }[] = [];
  for (const tag of TAGS) {
    for (const keyword of tag.search_keywords) {
      queries.push({
        tag: tag.id,
        keyword,
        query: `${keyword} ${region.name_uk}`,
      });
    }
  }

  const now = new Date().toISOString();
  const seen = new Set<string>();
  const candidates: Candidate[] = [];

  for (const q of queries) {
    try {
      const results = await tavilySearch(q.query);
      for (const r of results) {
        if (seen.has(r.url)) continue;
        seen.add(r.url);
        candidates.push({
          region_id: region.id,
          tag_id: q.tag,
          keyword: q.keyword,
          query: q.query,
          search_url: `tavily:${q.query}`,
          post_url: r.url,
          post_text:
            r.raw_content && r.raw_content.length > 200 ? r.raw_content : r.content,
          post_author: hostnameOf(r.url),
          post_image_urls: [],
          time_text: r.published_date ?? null,
          scraped_at: now,
          title: r.title,
          score: r.score,
        });
      }
    } catch (e) {
      console.error(`tavily query failed [${q.tag}/${q.keyword}]:`, (e as Error).message);
    }
  }

  return candidates;
}
