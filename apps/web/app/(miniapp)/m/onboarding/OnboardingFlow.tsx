// Three-step onboarding (city / interests / comfort). Each step calls
// /api/veteran/upsert optimistically. The final step also marks onboarded_at.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, CircleCheck, LocateFixed, MapPin, X } from "lucide-react";
import {
  ACCESSIBILITY_FLAGS,
  ACCESSIBILITY_LABELS_UK,
  DEMO_CITIES,
  IDENTITY_LABELS_UK,
  IDENTITY_PREFS,
  INTEREST_CATEGORIES,
  INTEREST_LABELS_UK,
  type AccessibilityFlag,
  type IdentityPref,
  type InterestCategory,
} from "@poruch/shared";
import { OnboardingCard } from "@/components/poruch/OnboardingCard";
import { Label } from "@/components/ui/label";
import { fetchWithInitData, getStartParam, getTgUser } from "@/lib/telegram/client";
import { cn } from "@/lib/utils";

type StepState = {
  city: string;
  interests: InterestCategory[];
  identity: IdentityPref;
  accessibility: AccessibilityFlag[];
  comfort: string;
};

const NEAREST_CITIES = [...DEMO_CITIES] as const;
// Approximate centroids for "Визначити автоматично" → nearest demo city.
const CITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Київ: { lat: 50.4501, lng: 30.5234 },
  Львів: { lat: 49.8397, lng: 24.0297 },
  Дніпро: { lat: 48.4647, lng: 35.0462 },
  Харків: { lat: 49.9935, lng: 36.2304 },
  Одеса: { lat: 46.4825, lng: 30.7233 },
  Полтава: { lat: 49.5883, lng: 34.5514 },
  Вінниця: { lat: 49.2331, lng: 28.4682 },
  Луцьк: { lat: 50.7472, lng: 25.3254 },
  Рівне: { lat: 50.6199, lng: 26.2516 },
};

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<StepState>({
    city: "",
    interests: [],
    identity: "any",
    accessibility: [],
    comfort: "",
  });
  const [bypassed, setBypassed] = useState(false);
  const [comfortOpen, setComfortOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Deep-link bypass: start_param=evt_<slug>  → skip onboarding to event page.
  useEffect(() => {
    const param = getStartParam();
    if (param.startsWith("evt_")) {
      setBypassed(true);
      router.replace(`/m/event/${param.slice(4)}`);
      return;
    }
    if (param.startsWith("defer_")) {
      setBypassed(true);
      router.replace("/m/feed");
      return;
    }
    void getTgUser();
  }, [router]);

  if (bypassed) return null;

  async function persistAndAdvance(patch: Record<string, unknown>, next: 1 | 2 | 3 | "done") {
    setBusy(true);
    try {
      const { status, json } = await fetchWithInitData<{ ok: boolean; error?: string }>(
        "/api/veteran/upsert",
        { method: "POST", body: JSON.stringify(patch) },
      );
      if (status !== 200 || !json?.ok) {
        console.warn("upsert failed:", json?.error);
      }
      if (next === "done") {
        router.push("/m/feed");
      } else {
        setStep(next);
      }
    } finally {
      setBusy(false);
    }
  }

  function detectLocation() {
    if (locating) return;
    setLocateError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocateError("Геолокація недоступна. Введи місто вручну.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const here = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const cities = Object.entries(CITY_COORDS);
        let bestName = cities[0]?.[0] ?? "Київ";
        let bestKm = Number.POSITIVE_INFINITY;
        for (const [name, c] of cities) {
          const km = haversineKm(here, c);
          if (km < bestKm) {
            bestKm = km;
            bestName = name;
          }
        }
        setState((s) => ({ ...s, city: bestName }));
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setLocateError(
          err.code === err.PERMISSION_DENIED
            ? "Доступ до геолокації заборонено."
            : "Не вдалось визначити. Введи вручну.",
        );
      },
      { timeout: 6000, maximumAge: 60_000 },
    );
  }

  return (
    <>
      {step === 1 ? (
        <OnboardingCard
          step={1}
          total={3}
          title="Де ти зараз?"
          subtitle="Щоб показати тільки те, що поруч."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() =>
            state.city.trim()
              ? persistAndAdvance({ city: state.city.trim() }, 2)
              : persistAndAdvance({}, 2)
          }
          onSkip={() => persistAndAdvance({}, 2)}
        >
          <CityStep
            value={state.city}
            onChange={(city) => setState({ ...state, city })}
            onDetect={detectLocation}
            locating={locating}
            locateError={locateError}
          />
        </OnboardingCard>
      ) : null}

      {step === 2 ? (
        <OnboardingCard
          step={2}
          total={3}
          title="Що тобі цікаво?"
          subtitle="Можна вибрати кілька. Або жодного — все одно покажемо."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() => persistAndAdvance({ interests: state.interests }, 3)}
          onSkip={() => persistAndAdvance({}, 3)}
        >
          <InterestStep
            value={state.interests}
            onChange={(interests) => setState({ ...state, interests })}
          />
        </OnboardingCard>
      ) : null}

      {step === 3 ? (
        <OnboardingCard
          step={3}
          total={3}
          title="Є щось важливе про комфорт?"
          subtitle="Це не обов'язково — можна пропустити. Поможе підбирати релевантні події."
          primaryLabel="Готово"
          busy={busy}
          onPrimary={() =>
            persistAndAdvance(
              {
                identity_prefs: state.identity,
                accessibility_flags: state.accessibility,
                comfort_notes: state.comfort.trim() ? state.comfort.trim() : null,
                mark_onboarded: true,
              },
              "done",
            )
          }
          onSkip={() => persistAndAdvance({ mark_onboarded: true }, "done")}
        >
          <ComfortStep
            open={comfortOpen}
            onToggle={() => setComfortOpen((v) => !v)}
            identity={state.identity}
            onIdentity={(v) => setState({ ...state, identity: v })}
            accessibility={state.accessibility}
            onAccessibility={(v) => setState({ ...state, accessibility: v })}
            comfort={state.comfort}
            onComfort={(v) => setState({ ...state, comfort: v })}
          />
        </OnboardingCard>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------
// Step 1 — city picker with input + nearest pills + geolocation
// ----------------------------------------------------------------

function CityStep({
  value,
  onChange,
  onDetect,
  locating,
  locateError,
}: {
  value: string;
  onChange: (v: string) => void;
  onDetect: () => void;
  locating: boolean;
  locateError: string | null;
}) {
  return (
    <div className="space-y-5">
      <div className="relative">
        <MapPin
          className="text-muted-foreground pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2"
          aria-hidden
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="наприклад, Київ"
          autoComplete="address-level2"
          className="bg-card border-border focus-visible:border-primary focus-visible:ring-primary/20 placeholder:text-muted-foreground h-13 w-full rounded-xl border px-11 text-base focus-visible:outline-none focus-visible:ring-2"
          style={{ touchAction: "manipulation", height: "52px" }}
          aria-label="Місто"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-muted-foreground hover:bg-muted absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full"
            aria-label="Очистити"
            style={{ touchAction: "manipulation" }}
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      <div className="space-y-2.5">
        <p className="text-muted-foreground text-xs font-semibold uppercase tracking-widest">
          Найближчі
        </p>
        <div className="flex flex-wrap gap-2">
          {NEAREST_CITIES.map((c) => {
            const active = value === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => onChange(c)}
                className={cn(
                  "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm transition",
                  active
                    ? "border-primary bg-accent text-primary"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
                style={{ touchAction: "manipulation" }}
                aria-pressed={active}
              >
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {c}
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={onDetect}
        disabled={locating}
        className="text-primary hover:bg-accent/40 inline-flex items-center gap-2 rounded-md px-2 py-2 text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60"
        style={{ touchAction: "manipulation" }}
      >
        <LocateFixed className={cn("h-4 w-4", locating && "animate-pulse")} aria-hidden />
        {locating ? "Шукаю…" : "Визначити автоматично"}
      </button>
      {locateError ? <p className="text-destructive text-xs">{locateError}</p> : null}
    </div>
  );
}

// ----------------------------------------------------------------
// Step 2 — interests as oval pills
// ----------------------------------------------------------------

function InterestStep({
  value,
  onChange,
}: {
  value: InterestCategory[];
  onChange: (v: InterestCategory[]) => void;
}) {
  const set = useMemo(() => new Set(value), [value]);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2.5">
        {INTEREST_CATEGORIES.map((c) => {
          const active = set.has(c);
          return (
            <button
              key={c}
              type="button"
              onClick={() => {
                const next = new Set(set);
                if (active) next.delete(c);
                else next.add(c);
                onChange([...next]);
              }}
              className={cn(
                "inline-flex h-11 items-center rounded-full border-2 px-5 text-sm font-medium transition",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-primary/60 bg-card text-primary hover:border-primary",
              )}
              style={{ touchAction: "manipulation" }}
              aria-pressed={active}
            >
              {INTEREST_LABELS_UK[c]}
            </button>
          );
        })}
      </div>
      {value.length === 0 ? (
        <p className="text-muted-foreground text-xs">Нічого не вибрано — це нормально.</p>
      ) : null}
    </div>
  );
}

// ----------------------------------------------------------------
// Step 3 — comfort: collapsed disclosure by default
// ----------------------------------------------------------------

function ComfortStep({
  open,
  onToggle,
  identity,
  onIdentity,
  accessibility,
  onAccessibility,
  comfort,
  onComfort,
}: {
  open: boolean;
  onToggle: () => void;
  identity: IdentityPref;
  onIdentity: (v: IdentityPref) => void;
  accessibility: AccessibilityFlag[];
  onAccessibility: (v: AccessibilityFlag[]) => void;
  comfort: string;
  onComfort: (v: string) => void;
}) {
  const accSet = useMemo(() => new Set(accessibility), [accessibility]);
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onToggle}
        className="bg-card border-border hover:border-primary/40 h-13 flex w-full items-center gap-3 rounded-xl border px-4 transition"
        style={{ touchAction: "manipulation", height: "52px" }}
        aria-expanded={open}
      >
        <CircleCheck className="text-primary h-5 w-5" aria-hidden />
        <span className="text-foreground flex-1 text-left text-base font-medium">
          {open ? "Згорнути" : "Розгорнути"}
        </span>
        <ChevronDown
          className={cn("text-muted-foreground h-5 w-5 transition-transform", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {open ? (
        <div className="space-y-5 pt-1">
          <div className="space-y-2">
            <Label>З ким комфортно</Label>
            <div className="flex flex-wrap gap-2">
              {IDENTITY_PREFS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => onIdentity(p)}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-sm transition",
                    identity === p
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                  style={{ touchAction: "manipulation" }}
                  aria-pressed={identity === p}
                >
                  {IDENTITY_LABELS_UK[p]}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label>Доступність</Label>
            <div className="flex flex-wrap gap-2">
              {ACCESSIBILITY_FLAGS.map((f) => {
                const active = accSet.has(f);
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => {
                      const next = new Set(accSet);
                      if (active) next.delete(f);
                      else next.add(f);
                      onAccessibility([...next]);
                    }}
                    className={cn(
                      "inline-flex h-9 items-center rounded-full border px-3 text-sm transition",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-foreground hover:border-primary/40",
                    )}
                    style={{ touchAction: "manipulation" }}
                    aria-pressed={active}
                  >
                    {ACCESSIBILITY_LABELS_UK[f]}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comfort">Що ще варто знати</Label>
            <textarea
              id="comfort"
              value={comfort}
              maxLength={200}
              onChange={(e) => onComfort(e.target.value)}
              rows={3}
              placeholder="наприклад, «зручніше у малих групах»"
              className="border-border bg-card focus-visible:border-primary focus-visible:ring-primary/20 min-h-[88px] w-full rounded-xl border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
          </div>
        </div>
      ) : null}
    </div>
  );
}
