// Source of truth for the design tokens that show up in JS (e.g. dynamic SVG fills,
// chart colors, email templates). The CSS values live in `apps/web/app/globals.css`.
// Keep them in sync.

export const PALETTE = {
  bg: "#FBF7F0",
  bgElevated: "#FFFFFF",
  surfaceSoft: "#F4ECDD",
  textPrimary: "#1F2A2E",
  textSecondary: "#5D6E72",
  textMuted: "#94A1A4",
  accent: "#2B6E5A",
  accentSoft: "#DDEEE7",
  warning: "#C97B3F",
  danger: "#B53A3A",
  honestAbsence: "#F5D8D2",
  honestAbsenceText: "#8A2A2A",
  border: "#E5DBC5",
  focus: "#2B6E5A",
} as const;

export type PaletteToken = keyof typeof PALETTE;
