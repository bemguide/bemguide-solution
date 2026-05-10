// Local-storage-backed accessibility + health preferences.
//
// Two namespaces:
//   - AppPrefs   — visual accessibility (font size, dark mode, colour
//                   palette). Applied to <html> via CSS classes / data
//                   attributes / inline `--app-font-scale`.
//   - HealthPrefs — onboarding answers about health-assistance needs;
//                   later consumed by the "Для тебе" tab to default
//                   the user into the Здоров'я category.
//
// V0 storage is localStorage only. The agent backend / v2 backend
// haven't gained these fields yet — when they do, swap the read/write
// helpers for API calls and seed localStorage as a cache. The shape
// below is the canonical wire form, so no migration is needed.

"use client";

export type FontSize = "s" | "m" | "l";
export type ColorblindPalette =
  | "standard"
  | "protanopia"
  | "deuteranopia"
  | "tritanopia";

export type AppPrefs = {
  fontSize: FontSize;
  darkMode: boolean;
  palette: ColorblindPalette;
};

export type HealthCategory =
  | "treatment"
  | "rehabilitation"
  | "mental_health"
  | "prosthetics"
  | "dentistry";

export type HealthPrefs = {
  /** null = user hasn't answered the trigger yet. */
  needed: boolean | null;
  category: HealthCategory | null;
  /** Slug values from HEALTH_DIRECTIONS in onboarding/options.ts. */
  directions: string[];
};

const APP_PREFS_KEY = "poruch.app_prefs.v1";
const HEALTH_PREFS_KEY = "poruch.health_prefs.v1";

export const DEFAULT_APP_PREFS: AppPrefs = {
  fontSize: "m",
  darkMode: false,
  palette: "standard",
};

export const DEFAULT_HEALTH_PREFS: HealthPrefs = {
  needed: null,
  category: null,
  directions: [],
};

const FONT_SCALE: Record<FontSize, number> = {
  s: 0.92,
  m: 1,
  l: 1.14,
};

export function loadAppPrefs(): AppPrefs {
  if (typeof window === "undefined") return DEFAULT_APP_PREFS;
  try {
    const raw = window.localStorage.getItem(APP_PREFS_KEY);
    if (!raw) return DEFAULT_APP_PREFS;
    const parsed = JSON.parse(raw) as Partial<AppPrefs>;
    return { ...DEFAULT_APP_PREFS, ...parsed };
  } catch {
    return DEFAULT_APP_PREFS;
  }
}

export function saveAppPrefs(prefs: AppPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(APP_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Quota exceeded / private mode — silently degrade. The user
    // sees the live-preview style during onboarding either way.
  }
}

/**
 * Mutate <html> so the rest of the app reflects `prefs`. Idempotent.
 *
 * Three knobs:
 *   - `--app-font-scale`: a CSS variable consumed by `body { font-size }`
 *     in globals.css. Multiplies the base 16px.
 *   - `.dark` class: toggles the dark-mode @theme overrides in
 *     globals.css.
 *   - `data-palette`: one of "protanopia" | "deuteranopia" | "tritanopia"
 *     (or unset for "standard"). Each maps to a colour-blind-safe
 *     primary/accent override in globals.css.
 */
export function applyAppPrefs(prefs: AppPrefs): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty("--app-font-scale", String(FONT_SCALE[prefs.fontSize]));
  root.classList.toggle("dark", prefs.darkMode);
  if (prefs.palette === "standard") {
    root.removeAttribute("data-palette");
  } else {
    root.setAttribute("data-palette", prefs.palette);
  }
}

export function loadHealthPrefs(): HealthPrefs {
  if (typeof window === "undefined") return DEFAULT_HEALTH_PREFS;
  try {
    const raw = window.localStorage.getItem(HEALTH_PREFS_KEY);
    if (!raw) return DEFAULT_HEALTH_PREFS;
    const parsed = JSON.parse(raw) as Partial<HealthPrefs>;
    return { ...DEFAULT_HEALTH_PREFS, ...parsed };
  } catch {
    return DEFAULT_HEALTH_PREFS;
  }
}

export function saveHealthPrefs(prefs: HealthPrefs): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(HEALTH_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* quota / private mode — non-fatal */
  }
}
