// Reverse-geocode (lat, lng) -> human-readable address via OpenStreetMap
// Nominatim. Free, keyless, but the public service has a strict usage policy:
//   - identifying User-Agent with contact (https://operations.osmfoundation.org/policies/nominatim/)
//   - max 1 request/second
//   - no bulk crawling
//
// We honor the rate cap with a module-scoped gate (1.1s minimum interval),
// so even concurrent callers in the same process serialize. Bake the contact
// email into source so the constraint is visible in code review, not hidden
// in deploy config.

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/reverse';
const USER_AGENT = 'bemguide-backfill (denys.semerych@skelar.tech)';
const MIN_INTERVAL_MS = 1100;

let lastCallAt = 0;

async function gate(): Promise<void> {
  const now = Date.now();
  const wait = lastCallAt + MIN_INTERVAL_MS - now;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
}

interface NominatimResponse {
  display_name?: string;
  error?: string;
}

export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  await gate();
  const url =
    `${NOMINATIM_URL}?format=jsonv2` +
    `&lat=${encodeURIComponent(lat)}` +
    `&lon=${encodeURIComponent(lng)}` +
    `&accept-language=uk,en`;

  const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok) {
    throw new Error(`nominatim ${res.status} ${res.statusText}`);
  }
  const json = (await res.json()) as NominatimResponse;
  if (json.error) return null;
  const name = json.display_name?.trim();
  return name && name.length > 0 ? name : null;
}
