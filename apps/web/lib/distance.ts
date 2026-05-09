// Mirror of supabase/functions/_shared/distance.ts so the Next.js side can
// compute distances without round-tripping to an edge function.

const CITY_CENTROIDS: Record<string, { lat: number; lng: number }> = {
  Київ: { lat: 50.4501, lng: 30.5234 },
  Львів: { lat: 49.8397, lng: 24.0297 },
  Дніпро: { lat: 48.4647, lng: 35.0462 },
  Харків: { lat: 49.9935, lng: 36.2304 },
  Одеса: { lat: 46.4825, lng: 30.7233 },
  Вінниця: { lat: 49.2331, lng: 28.4682 },
  Полтава: { lat: 49.5883, lng: 34.5514 },
  Луцьк: { lat: 50.7472, lng: 25.3254 },
  "Івано-Франківськ": { lat: 48.9226, lng: 24.7111 },
  Рівне: { lat: 50.6199, lng: 26.2516 },
};

export function haversineKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function distanceKm(
  veteranCity: string | null,
  eventLat: number | null,
  eventLng: number | null,
): number | null {
  if (!veteranCity || eventLat == null || eventLng == null) return null;
  const centroid = CITY_CENTROIDS[veteranCity];
  if (!centroid) return null;
  return Math.round(haversineKm(centroid, { lat: eventLat, lng: eventLng }) * 10) / 10;
}

export function hoursUntil(iso: string, now: Date = new Date()): number {
  const start = new Date(iso).getTime();
  return Math.max(0, Math.round((start - now.getTime()) / 36e5));
}
