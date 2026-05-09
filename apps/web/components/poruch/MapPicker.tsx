// Inline map for /m/propose's "Де" section. Dropping a pin is the primary
// way to specify where an event is — the address text input below the
// map is just a human-readable label.
//
// Per-city `CITY_MAP` defines the center/zoom and `maxBounds` so users
// can't pan to a different country. New cities get added to the map
// when their feeds unlock end-to-end.
//
// Tile source: CartoDB "light_all" via OpenStreetMap data. No API key,
// usage policy permits free non-commercial use; attribution lives in
// the bottom-right of the canvas as Leaflet's default attribution
// control.
//
// Performance: the parent dynamic-imports this with `ssr: false` so
// Leaflet (~42KB gz) only ships to the proposer surface.

"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import { LocateFixed, MapPin } from "lucide-react";
import "leaflet/dist/leaflet.css";
import { cn } from "@/lib/utils";
import { getCityMapConfig } from "@/lib/cities";

type Pin = { lat: number; lng: number };

// Inline SVG so we don't ship Leaflet's default marker raster (the one
// that needs `leaflet/dist/images/marker-icon.png` symlinks). Brand teal
// (#2b6e5a) matches --primary in globals.css.
const PIN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="40" viewBox="0 0 32 40" aria-hidden="true">
  <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 24 16 24s16-12 16-24C32 7.16 24.84 0 16 0z" fill="#2b6e5a" stroke="#ffffff" stroke-width="2"/>
  <circle cx="16" cy="16" r="5" fill="#ffffff"/>
</svg>`;

export type MapPickerProps = {
  city: string;
  pin: Pin | null;
  onChange: (pin: Pin) => void;
  onLocate: () => void;
  locating: boolean;
  /** Visual + ARIA red state when the form was submitted with no pin. */
  invalid?: boolean;
};

export function MapPicker({ city, pin, onChange, onLocate, locating, invalid }: MapPickerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  // Hold the latest onChange in a ref so the click handler always reads
  // current state without us reattaching the listener every render.
  const onChangeRef = useRef(onChange);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  // Initialise the map once. Strict Mode's double-mount in dev is handled
  // by the cleanup that calls `map.remove()`.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const config = getCityMapConfig(city);
    const map = L.map(el, {
      center: config.center,
      zoom: config.zoom,
      maxBounds: L.latLngBounds(config.bounds),
      maxBoundsViscosity: 1.0,
      zoomControl: true,
      attributionControl: true,
      // Mouse wheel inside a vertically-scrolling form would fight the
      // outer scroll — keep wheel zoom off; pinch-zoom on touch and the
      // visible +/- controls cover the rest.
      scrollWheelZoom: false,
      keyboard: true,
      // `tap` was removed from Leaflet's MapOptions in @types/leaflet
      // 1.9.x — it's enabled by default on touch now, so dropping
      // the explicit `tap: true` is a no-op at runtime.
    });

    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
      maxZoom: 19,
      minZoom: 11,
      subdomains: "abcd",
    }).addTo(map);

    map.on("click", (e) => {
      onChangeRef.current({ lat: e.latlng.lat, lng: e.latlng.lng });
    });

    mapRef.current = map;

    // Leaflet sometimes initialises into a 0-sized container if its
    // flex parent hasn't measured yet — re-invalidate on size changes
    // so tiles render correctly on first paint and after viewport
    // changes (TMA keyboard show/hide).
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);

    return () => {
      ro.disconnect();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // We intentionally re-init only on unmount; city/pin changes are
    // applied by the dedicated effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // City changes (e.g. when a different city unlocks) → re-bound and
  // re-centre. We don't snap the view if there's already a pin — the
  // user might be intentionally pinning across the new bounds.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const config = getCityMapConfig(city);
    map.setMaxBounds(L.latLngBounds(config.bounds));
    if (!pin) map.setView(config.center, config.zoom);
  }, [city, pin]);

  // Sync marker with pin state.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (!pin) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }

    if (!markerRef.current) {
      const icon = L.divIcon({
        // Empty string overrides Leaflet's default `leaflet-div-icon`
        // class so we don't get the default white square frame.
        className: "",
        html: PIN_SVG,
        iconSize: [32, 40],
        iconAnchor: [16, 40],
      });
      const marker = L.marker([pin.lat, pin.lng], {
        icon,
        draggable: true,
        keyboard: false,
      });
      marker.on("dragend", () => {
        const ll = marker.getLatLng();
        onChangeRef.current({ lat: ll.lat, lng: ll.lng });
      });
      marker.addTo(map);
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([pin.lat, pin.lng]);
    }

    map.panTo([pin.lat, pin.lng], { animate: true });
  }, [pin]);

  return (
    <div className="space-y-2">
      <div
        className={cn(
          "border-border bg-muted relative h-56 w-full overflow-hidden rounded-xl border",
          invalid && "border-destructive ring-destructive/20 ring-2",
        )}
      >
        <div
          ref={containerRef}
          role="application"
          aria-label="Мапа для вибору місця події. Натисни, щоб поставити мітку, або перетягни наявну."
          className="h-full w-full"
          style={{ touchAction: "none" }}
        />
        <button
          type="button"
          onClick={onLocate}
          disabled={locating}
          aria-label="Поставити мою поточну локацію як мітку події"
          className="bg-card border-border text-primary hover:bg-accent disabled:opacity-50 absolute right-3 top-3 z-[400] inline-flex h-11 w-11 items-center justify-center rounded-full border shadow-sm"
          style={{ touchAction: "manipulation" }}
        >
          <LocateFixed
            className={cn("h-5 w-5", locating && "animate-pulse")}
            aria-hidden
          />
        </button>
      </div>
      {pin ? (
        <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
          <MapPin className="h-3.5 w-3.5" aria-hidden />
          Мітка поставлена. Перетягни — якщо хочеш уточнити.
        </p>
      ) : (
        <p className={cn("text-xs", invalid ? "text-destructive" : "text-muted-foreground")}>
          Натисни на мапу або скористайся кнопкою «моя локація» —
          ми покажемо подію тим, хто поряд.
        </p>
      )}
    </div>
  );
}
