// Horizontal strip of accessibility chips. Honest absences render in muted-red so
// the user sees what's NOT adapted alongside what is. Icon never appears alone —
// every chip has a Ukrainian label.

import {
  Accessibility,
  Ban,
  CarFront,
  Dog,
  Ear,
  Eye,
  Footprints,
  Hand,
  HeartHandshake,
  Volume2,
  VolumeX,
  WineOff,
} from "lucide-react";
import type { AccessibilityFlag } from "@poruch/shared";
import { ACCESSIBILITY_LABELS_UK } from "@poruch/shared";

type IconType = typeof Accessibility;

const ICONS: Record<AccessibilityFlag, IconType> = {
  barrier_free: Accessibility,
  no_stairs: Footprints,
  quiet_room: VolumeX,
  no_alcohol: WineOff,
  sign_language: Hand,
  audio_described: Ear,
  sensory_friendly: HeartHandshake,
  parking_disabled: CarFront,
  service_animal_ok: Dog,
};

export function AccessibilityStrip({
  flags,
  honestAbsences,
}: {
  flags: readonly AccessibilityFlag[];
  honestAbsences: readonly string[] | null;
}) {
  if (flags.length === 0 && (!honestAbsences || honestAbsences.length === 0)) return null;
  return (
    <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1">
      {flags.map((flag) => {
        const Icon = ICONS[flag] ?? Accessibility;
        return (
          <div
            key={flag}
            className="bg-accent text-accent-foreground border-border flex min-w-[88px] shrink-0 snap-start flex-col items-center gap-1 rounded-lg border px-2.5 py-2"
            aria-label={ACCESSIBILITY_LABELS_UK[flag]}
          >
            <Icon className="h-5 w-5" aria-hidden />
            <span className="text-center text-xs leading-tight">
              {ACCESSIBILITY_LABELS_UK[flag]}
            </span>
          </div>
        );
      })}
      {(honestAbsences ?? []).map((absence) => (
        <div
          key={absence}
          className="bg-honest-absence text-honest-absence-foreground border-honest-absence-foreground/20 flex min-w-[120px] shrink-0 snap-start flex-col items-center gap-1 rounded-lg border px-2.5 py-2"
          aria-label={`Чесно немає: ${absence}`}
        >
          <Ban className="h-5 w-5" aria-hidden />
          <span className="text-center text-xs leading-tight">{absence}</span>
        </div>
      ))}
    </div>
  );
}

// Compact variant for cards: just a row of small icons + tooltips.
export function AccessibilityChips({
  flags,
  max = 3,
}: {
  flags: readonly AccessibilityFlag[];
  max?: number;
}) {
  if (!flags.length) return null;
  const shown = flags.slice(0, max);
  const more = flags.length - shown.length;
  return (
    <div className="text-muted-foreground flex items-center gap-1 text-xs">
      {shown.map((flag) => {
        const Icon = ICONS[flag] ?? Accessibility;
        return (
          <span
            key={flag}
            className="bg-accent text-accent-foreground inline-flex items-center gap-1 rounded-md px-1.5 py-0.5"
            aria-label={ACCESSIBILITY_LABELS_UK[flag]}
          >
            <Icon className="h-3 w-3" aria-hidden />
            <span className="text-[11px]">{ACCESSIBILITY_LABELS_UK[flag]}</span>
          </span>
        );
      })}
      {more > 0 ? <span className="text-[11px]">+{more}</span> : null}
    </div>
  );
}

const _unusedVolume = Volume2;
const _unusedEye = Eye;
void _unusedVolume;
void _unusedEye;
