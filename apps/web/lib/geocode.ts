// Reverse geocoding via Nominatim (OpenStreetMap). No API key, free for
// low-volume use. Called from /m/propose's pin handler after the user
// drops or moves a marker — per-user volume is minimal.
//
// Usage policy: https://operations.osmfoundation.org/policies/nominatim/
//   - Sustained traffic above 1 req/s requires a self-hosted instance.
//     Our miniapp's pin-set events are well below that.
//   - Browser Referer/User-Agent identify the surface automatically.
//
// Returns a short Ukrainian address string ("вул. Грушевського, 5"), or
// null when the response has nothing usable. Network errors and timeouts
// also resolve to null so the caller can leave the address field empty
// without surfacing an error to the user.

export type ReverseGeocodeResult = string | null;

type NominatimAddress = {
  road?: string;
  house_number?: string;
  pedestrian?: string;
  footway?: string;
  path?: string;
  cycleway?: string;
  amenity?: string;
  building?: string;
  shop?: string;
  suburb?: string;
  neighbourhood?: string;
  quarter?: string;
  [key: string]: string | undefined;
};

type NominatimResponse = {
  display_name?: string;
  address?: NominatimAddress;
};

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse";

export async function reverseGeocode(
  lat: number,
  lng: number,
  opts: { language?: string; timeoutMs?: number } = {},
): Promise<ReverseGeocodeResult> {
  const url = new URL(NOMINATIM_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", lat.toFixed(6));
  url.searchParams.set("lon", lng.toFixed(6));
  url.searchParams.set("addressdetails", "1");
  // zoom=18 = street/building level. Lower zooms collapse to suburb /
  // city — too coarse for "де відбудеться подія".
  url.searchParams.set("zoom", "18");
  url.searchParams.set("accept-language", opts.language ?? "uk");

  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResponse;
    return formatAddress(data);
  } catch {
    // Timeout, network error, abort, malformed JSON — caller treats null
    // as "no address available, leave the field empty".
    return null;
  }
}

function formatAddress(data: NominatimResponse): string | null {
  const a = data.address;
  if (!a) return null;

  // Prefer a named venue when Nominatim has one (library, café, etc.).
  const named = a.amenity || a.shop || a.building;

  // Street-level address: street + house number when available.
  const street = a.road || a.pedestrian || a.footway || a.path || a.cycleway;
  const streetWithNumber = street
    ? a.house_number
      ? `${street}, ${a.house_number}`
      : street
    : null;

  if (named && streetWithNumber) return `${named}, ${streetWithNumber}`;
  if (named) return named;
  if (streetWithNumber) return streetWithNumber;

  // Fallback: neighbourhood / suburb / quarter — better than nothing.
  return a.suburb || a.neighbourhood || a.quarter || null;
}
