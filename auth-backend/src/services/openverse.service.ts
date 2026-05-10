// Search Openverse for a representative image URL for a free-text query.
// Openverse aggregates Wikimedia Commons + Flickr CC + museum collections.
// API is keyless and rate-limited per IP; for our one-off backfill we run
// well below the anonymous quota.
//
// Returns the first result's hosted URL, or null when the query yields
// nothing usable. Callers should treat null as "leave the column NULL"
// rather than failing the row.

const OPENVERSE_URL = 'https://api.openverse.org/v1/images/';
const USER_AGENT = 'bemguide-backfill (denys.semerych@skelar.tech)';

interface OpenverseImage {
  url?: string;
  thumbnail?: string;
}

interface OpenverseResponse {
  result_count?: number;
  results?: OpenverseImage[];
}

export async function searchTopImage(query: string): Promise<string | null> {
  const trimmed = query.trim();
  if (trimmed.length === 0) return null;

  const url =
    `${OPENVERSE_URL}?q=${encodeURIComponent(trimmed)}` +
    `&page_size=5` +
    `&mature=false`;

  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
  });
  if (!res.ok) {
    throw new Error(`openverse ${res.status} ${res.statusText}`);
  }

  const json = (await res.json()) as OpenverseResponse;
  const results = json.results ?? [];
  for (const item of results) {
    if (typeof item.url === 'string' && item.url.length > 0) {
      return item.url;
    }
  }
  return null;
}
