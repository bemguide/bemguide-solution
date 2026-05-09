// Per-city map configuration for the inline pin picker on /m/propose
// (and anything else that needs city-bounded coords). Lives outside
// the MapPicker component so callers can validate without importing
// Leaflet.

export type CityMapConfig = {
  /** Map view centre when no pin is set yet. */
  center: [number, number];
  /** Initial zoom — should fit the whole city. */
  zoom: number;
  /**
   * `[[swLat, swLng], [neLat, neLng]]` bounding box. Used as Leaflet's
   * `maxBounds` AND for client-side validation (e.g. rejecting a "use
   * my location" hit that's actually in a different oblast).
   */
  bounds: [[number, number], [number, number]];
};

export const CITY_MAP: Record<string, CityMapConfig> = {
  Дніпро: {
    center: [48.4647, 35.0462],
    zoom: 12,
    bounds: [
      [48.385, 34.85],
      [48.55, 35.21],
    ],
  },
  // Add other cities here as their feeds unlock end-to-end.
};

const FALLBACK_CITY = "Дніпро";

export function getCityMapConfig(city: string): CityMapConfig {
  return CITY_MAP[city] ?? CITY_MAP[FALLBACK_CITY]!;
}

export function isWithinCityBounds(
  city: string,
  p: { lat: number; lng: number },
): boolean {
  const {
    bounds: [[swLat, swLng], [neLat, neLng]],
  } = getCityMapConfig(city);
  return p.lat >= swLat && p.lat <= neLat && p.lng >= swLng && p.lng <= neLng;
}
