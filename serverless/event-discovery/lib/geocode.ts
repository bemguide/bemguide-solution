/**
 * Photon (Komoot OSM) geocoder, no API key.
 */

const PHOTON_URL = "https://photon.komoot.io/api/";
const POLITE_DELAY_MS = 200;

const FALLBACK_LAT = Number(process.env.GEOCODE_FALLBACK_LAT ?? 48.4647);
const FALLBACK_LNG = Number(process.env.GEOCODE_FALLBACK_LNG ?? 35.0462);

const cache = new Map<string, { lat: number; lng: number; resolved: boolean }>();
let lastRequestAt = 0;
let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const next = queue.then(fn, fn);
  queue = next.catch(() => undefined);
  return next;
}

type PhotonResp = {
  features?: { geometry: { coordinates: [number, number] } }[];
};

async function photon(query: string): Promise<{ lat: number; lng: number } | null> {
  return enqueue(async () => {
    const wait = lastRequestAt + POLITE_DELAY_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    lastRequestAt = Date.now();

    try {
      const resp = await fetch(
        `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=1`,
      );
      if (!resp.ok) return null;
      const data = (await resp.json()) as PhotonResp;
      const feat = data.features?.[0];
      if (!feat) return null;
      const [lng, lat] = feat.geometry.coordinates;
      return isFinite(lat) && isFinite(lng) ? { lat, lng } : null;
    } catch {
      return null;
    }
  });
}

function cleanVariants(venue: string): string[] {
  const out = new Set<string>();
  out.add(venue.trim());
  const noParens = venue.replace(/\([^)]*\)/gu, "").trim().replace(/\s+/gu, " ");
  if (noParens) out.add(noParens);
  const noCity = noParens.replace(/^м\.?\s*[А-ЯҐЄІЇа-яґєії]+,?\s*/u, "").trim();
  if (noCity) out.add(noCity);
  return [...out];
}

export async function geocode(
  venueText: string | null,
  city: string,
): Promise<{ lat: number; lng: number; resolved: boolean }> {
  if (!venueText || venueText.trim().length < 4) {
    return { lat: FALLBACK_LAT, lng: FALLBACK_LNG, resolved: false };
  }
  const variants = cleanVariants(venueText);
  const queries: string[] = [];
  for (const v of variants) queries.push(`${v}, ${city}, Україна`);
  for (const v of variants) queries.push(v);

  for (const q of queries) {
    const cached = cache.get(q);
    if (cached) return cached;
    const r = await photon(q);
    const out = r
      ? { lat: r.lat, lng: r.lng, resolved: true }
      : { lat: FALLBACK_LAT, lng: FALLBACK_LNG, resolved: false };
    cache.set(q, out);
    if (out.resolved) return out;
  }
  return { lat: FALLBACK_LAT, lng: FALLBACK_LNG, resolved: false };
}
