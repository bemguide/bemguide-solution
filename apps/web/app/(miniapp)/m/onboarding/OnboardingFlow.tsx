// 14–16 single-question substeps + 1 greeting over the v2 `users`
// schema plus two locally-stored namespaces (AppPrefs, HealthPrefs).
// Each screen asks exactly one thing — keeps tap targets big, the
// progress strip honest, and avoids "wall of form" on the comfort and
// about screens that previously stacked 3-4 fields.
//
//   step  field                  PATCH /me slice / local
//   ────  ─────────────────────  ────────────────────────────────
//   0     greeting               (no PATCH)
//   1     city                   { city }
//   2     accessibility prefs    localStorage: AppPrefs (font / dark / palette)
//   3     health needed?         localStorage: HealthPrefs.needed
//   4     health category        localStorage: HealthPrefs.category    ◀── only if needed=yes
//   5     health directions      localStorage: HealthPrefs.directions  ◀── only if needed=yes
//   6     display_name+privacy   { display_name, show_name_publicly }
//   7     interests              { interests }
//   8     availability           { availability }
//   9     schedule_constraints   { schedule_constraints }
//   10    company_preference     { company_preference }
//   11    accessibility_flags    { accessibility_flags }
//   12    triggers_to_avoid      { triggers_to_avoid }
//   13    veteran_status         { veteran_status }
//   14    role_in_group          { role_in_group }
//   15    age_range              { age_range }
//   16    bio                    { bio }
//
// Pre-fill from Telegram (where TG exposes it):
//   - display_name <- initDataUnsafe.user.first_name (waits for SDK)
//
// Deep-link bypass:
//   evt_<id>   → /m/event/<id>
//   defer_<id> → /m/feed
//
// Progress bar maths:
//   - When the user picks "no" on step 3 (health), steps 4 and 5 are
//     skipped → total bars drop from 16 to 14 and bar indices for
//     steps 6+ shrink by 2. `barIndex()` and `totalBars()` encode it.
//
// AppPrefs and HealthPrefs are V0 localStorage-only. The agent
// backend / v2 backend haven't gained these fields yet — when they do,
// swap `saveAppPrefs` / `saveHealthPrefs` for API calls.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Heart,
  LocateFixed,
  MapPin,
  Mic,
  Moon,
  Palette,
  Sun,
  Type,
  Volume2,
  X,
} from "lucide-react";
import { DEMO_CITIES } from "@poruch/shared";
import {
  OnboardingStep,
  StepHeading,
  StepSubheading,
} from "@/components/poruch/OnboardingStep";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import {
  getStartParam,
  getTgUserWithWait,
  tgGetLocation,
  tgLocationDenied,
  tgOpenLocationSettings,
} from "@/lib/telegram/client";
import { cn } from "@/lib/utils";
import {
  describeError,
  logApiError,
  updateCurrentUser,
  type AccessibilityFlag,
  type AgeRange,
  type CompanyPreference,
  type UserPatch,
  type VeteranStatus,
} from "@/lib/api";
import {
  applyAppPrefs,
  DEFAULT_APP_PREFS,
  loadAppPrefs,
  loadHealthPrefs,
  saveAppPrefs,
  saveHealthPrefs,
  type AppPrefs,
  type ColorblindPalette,
  type FontSize,
  type HealthCategory,
  type HealthPrefs,
} from "@/lib/app-prefs";
import {
  ACCESSIBILITY_OPTIONS,
  AGE_RANGE_OPTIONS,
  AVAILABILITY_OPTIONS,
  COMPANY_PREFERENCE_OPTIONS,
  FONT_SIZE_OPTIONS,
  HEALTH_CATEGORY_OPTIONS,
  HEALTH_DIRECTIONS,
  INTEREST_OPTIONS,
  PALETTE_OPTIONS,
  ROLE_IN_GROUP_OPTIONS,
  TRIGGER_OPTIONS,
  VETERAN_STATUS_OPTIONS,
  type Option,
} from "./options";

const TOTAL_STEPS_NO_HEALTH = 14;
const TOTAL_STEPS_WITH_HEALTH = 16;

/**
 * Demo restriction: backend seed data only covers Дніпро for now, so
 * we expose Дніпро as the single working option and visually disable
 * the rest. Other Demo cities stay on screen as "soon" placeholders
 * so users see the surface that's coming, without being able to pick
 * one and end up on an empty feed.
 */
const ENABLED_CITY = "Дніпро";

type StepIndex =
  | 0
  | 1
  | 2
  | 3
  | 4
  | 5
  | 6
  | 7
  | 8
  | 9
  | 10
  | 11
  | 12
  | 13
  | 14
  | 15
  | 16;

const NEAREST_CITIES = [...DEMO_CITIES] as const;

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

type FormState = {
  city: string;
  appPrefs: AppPrefs;
  healthNeeded: boolean | null;
  healthCategory: HealthCategory | null;
  healthDirections: string[];
  displayName: string;
  showNamePublicly: boolean;
  interests: string[];
  availability: string[];
  scheduleConstraints: string;
  companyPreference: CompanyPreference;
  accessibility: AccessibilityFlag[];
  triggers: string[];
  veteranStatus: VeteranStatus | null;
  ageRange: AgeRange | null;
  roleInGroup: string;
  bio: string;
};

const initialState: FormState = {
  // Pre-selected because every other chip is disabled — saves the
  // user a tap on Step 1.
  city: ENABLED_CITY,
  appPrefs: DEFAULT_APP_PREFS,
  healthNeeded: null,
  healthCategory: null,
  healthDirections: [],
  displayName: "",
  showNamePublicly: false,
  interests: [],
  availability: [],
  scheduleConstraints: "",
  companyPreference: "any",
  accessibility: [],
  triggers: [],
  veteranStatus: null,
  ageRange: null,
  roleInGroup: "",
  bio: "",
};

/**
 * Map a global step (0..16) onto the bar index that should be filled
 * by the time the user lands on that screen. Greeting renders -1 (no
 * bars). When the user said "no" on step 3, steps 4–5 are skipped, so
 * step 6 lands on bar 3 instead of bar 5.
 */
function barIndex(globalStep: number, healthYes: boolean): number {
  if (globalStep === 0) return -1;
  if (globalStep <= 5) return globalStep - 1;
  return healthYes ? globalStep - 1 : globalStep - 3;
}

function totalBars(healthYes: boolean): number {
  return healthYes ? TOTAL_STEPS_WITH_HEALTH : TOTAL_STEPS_NO_HEALTH;
}

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<StepIndex>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [state, setState] = useState<FormState>(initialState);

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Bootstrap: deep-link bypass + Telegram pre-fill (waits for SDK)
  // + restore any AppPrefs / HealthPrefs the user already has from a
  // prior session (so the toggles on step 2/3 reflect reality).
  useEffect(() => {
    let cancelled = false;
    async function init() {
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

      const storedApp = loadAppPrefs();
      const storedHealth = loadHealthPrefs();
      if (!cancelled) {
        setState((s) => ({
          ...s,
          appPrefs: storedApp,
          healthNeeded: storedHealth.needed,
          healthCategory: storedHealth.category,
          healthDirections: storedHealth.directions,
        }));
      }

      const tg = await getTgUserWithWait();
      if (cancelled) return;
      // Compose a pre-filled display_name from whatever TG gave us.
      // first_name alone reads more naturally than full name; we add
      // last_name only if first_name is missing or empty.
      const candidate = (tg.firstName ?? tg.lastName ?? tg.username ?? "").trim();
      if (candidate) setState((s) => ({ ...s, displayName: candidate }));
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (bypassed) return null;

  async function persist(patch: UserPatch): Promise<boolean> {
    try {
      await updateCurrentUser(patch);
      return true;
    } catch (e) {
      logApiError("onboarding", e);
      setError(describeError(e, "onboarding"));
      return false;
    }
  }

  async function advance(patch: UserPatch | null, next: StepIndex | "done") {
    setBusy(true);
    setError(null);
    try {
      if (patch && Object.keys(patch).length > 0) await persist(patch);
      if (next === "done") router.push("/m/feed");
      else setStep(next);
    } finally {
      setBusy(false);
    }
  }

  // ---------- Per-step commits ----------

  function go(skipPatch: boolean, patchFn: () => UserPatch, next: StepIndex | "done") {
    void advance(skipPatch ? {} : patchFn(), next);
  }

  // Live-preview helper for the Адаптація step. Mutates form state,
  // applies the prefs to <html> immediately so the user sees the
  // change, and persists to localStorage so it survives a reload —
  // even if they hit "Назад" via Telegram BackButton without
  // completing onboarding.
  function setAppPrefs(next: AppPrefs) {
    setState((s) => ({ ...s, appPrefs: next }));
    applyAppPrefs(next);
    saveAppPrefs(next);
  }

  function setHealthPrefs(next: HealthPrefs) {
    setState((s) => ({
      ...s,
      healthNeeded: next.needed,
      healthCategory: next.category,
      healthDirections: next.directions,
    }));
    saveHealthPrefs(next);
  }

  // ---------- Step 1: city geolocation ----------

  async function detectLocation() {
    if (locating) return;
    setLocateError(null);
    setLocating(true);
    try {
      const tgLoc = await tgGetLocation();
      if (tgLoc) {
        setState((s) => ({ ...s, city: pickNearestCity(tgLoc) }));
        return;
      }
      if (tgLocationDenied()) {
        setLocateError("denied:tg");
        return;
      }
      const browser = await browserGeolocate();
      if (browser === "denied") setLocateError("denied:browser");
      else if (browser === "fail") setLocateError("fail");
      else setState((s) => ({ ...s, city: pickNearestCity(browser) }));
    } finally {
      setLocating(false);
    }
  }

  // ---------- Render ----------

  const healthYes = state.healthNeeded === true;
  const total = totalBars(healthYes);
  const bar = (gs: number) => barIndex(gs, healthYes);

  if (step === 0) {
    return (
      <OnboardingStep
        step={bar(0)}
        total={total}
        primaryLabel="Подивитись поруч"
        busy={busy}
        onPrimary={() => void advance(null, 1)}
      >
        <div className="space-y-3 pt-2">
          <StepHeading>
            Привіт. Я допомагаю ветеранам зібратися разом — на каву, прогулянку, спорт.
          </StepHeading>
          <StepSubheading>
            Більшість того, що тут — безкоштовне. Без папок, без анкет.
          </StepSubheading>
        </div>
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 1) {
    return (
      <OnboardingStep
        step={bar(1)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Не зараз, тільки гляну"
        busy={busy}
        onPrimary={() =>
          go(!state.city.trim(), () => ({ city: state.city.trim() }), 2)
        }
        onSkip={() => void advance({}, 2)}
      >
        <div className="space-y-2">
          <StepHeading>Де ти зараз?</StepHeading>
          <StepSubheading>Покажемо тільки те, що поруч.</StepSubheading>
        </div>
        <CityStep
          value={state.city}
          onChange={(city) => setState({ ...state, city })}
          onDetect={() => void detectLocation()}
          onOpenSettings={tgOpenLocationSettings}
          locating={locating}
          locateError={locateError}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 2) {
    return (
      <OnboardingStep
        step={bar(2)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => void advance(null, 3)}
        onSkip={() => void advance(null, 3)}
      >
        <div className="space-y-2">
          <StepHeading>Адаптація застосунку</StepHeading>
          <StepSubheading>Налаштуй під себе — побачиш зміни одразу.</StepSubheading>
        </div>
        <AdaptationStep prefs={state.appPrefs} onChange={setAppPrefs} />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 3) {
    return (
      <OnboardingStep
        step={bar(3)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        primaryDisabled={state.healthNeeded === null}
        onPrimary={() => {
          // "Yes" → branch into the health-detail subflow (steps 4-5).
          // "No" → skip directly to step 6 (display_name).
          const next: StepIndex = state.healthNeeded === true ? 4 : 6;
          if (state.healthNeeded === false) {
            // Clear any leftover detail answers from a previous "yes".
            setHealthPrefs({ needed: false, category: null, directions: [] });
          }
          void advance(null, next);
        }}
        onSkip={() => void advance(null, 6)}
      >
        <div className="space-y-2">
          <StepHeading>Чи потрібна тобі допомога зі здоров'ям?</StepHeading>
          <StepSubheading>
            Якщо так — підкажемо релевантні заклади і програми. Завжди
            можна змінити.
          </StepSubheading>
        </div>
        <HealthTriggerStep
          value={state.healthNeeded}
          onChange={(needed) =>
            setHealthPrefs({
              needed,
              category: needed ? state.healthCategory : null,
              directions: needed ? state.healthDirections : [],
            })
          }
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 4) {
    return (
      <OnboardingStep
        step={bar(4)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        primaryDisabled={state.healthCategory === null}
        onPrimary={() => void advance(null, 5)}
        onSkip={() => void advance(null, 6)}
      >
        <div className="space-y-2">
          <StepHeading>Обери</StepHeading>
          <StepSubheading>Що для тебе зараз найважливіше?</StepSubheading>
        </div>
        <HealthCategoryStep
          value={state.healthCategory}
          onChange={(category) =>
            setHealthPrefs({
              needed: true,
              category,
              // Clearing directions when category changes — they're
              // category-scoped slugs, mixing them across categories
              // makes the persisted record incoherent.
              directions: state.healthCategory === category
                ? state.healthDirections
                : [],
            })
          }
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 5) {
    const directions =
      state.healthCategory ? HEALTH_DIRECTIONS[state.healthCategory] : [];
    return (
      <OnboardingStep
        step={bar(5)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => void advance(null, 6)}
        onSkip={() => void advance(null, 6)}
      >
        <div className="space-y-2">
          <StepHeading>Обери напрямок</StepHeading>
          <StepSubheading>Можна кілька — або жодного.</StepSubheading>
        </div>
        <HealthDirectionStep
          options={directions}
          value={state.healthDirections}
          onChange={(directions) =>
            setHealthPrefs({
              needed: true,
              category: state.healthCategory,
              directions,
            })
          }
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 6) {
    const name = state.displayName.trim();
    return (
      <OnboardingStep
        step={bar(6)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() =>
          void advance(
            {
              display_name: name || null,
              show_name_publicly: name ? state.showNamePublicly : false,
            },
            7,
          )
        }
        onSkip={() => void advance({}, 7)}
      >
        <div className="space-y-2">
          <StepHeading>Як до тебе звертатися?</StepHeading>
          <StepSubheading>Можна анонімно — тоді інші бачитимуть тільки кількість.</StepSubheading>
        </div>
        <NameStep
          displayName={state.displayName}
          onDisplayName={(displayName) => setState({ ...state, displayName })}
          showPublicly={state.showNamePublicly}
          onShowPublicly={(showNamePublicly) => setState({ ...state, showNamePublicly })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 7) {
    return (
      <OnboardingStep
        step={bar(7)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => go(false, () => ({ interests: state.interests }), 8)}
        onSkip={() => void advance({}, 8)}
      >
        <div className="space-y-2">
          <StepHeading>Що цікаво?</StepHeading>
          <StepSubheading>Кілька — або жодного. Все одно покажемо щось поруч.</StepSubheading>
        </div>
        <ChipMultiToggleGroup
          options={INTEREST_OPTIONS}
          value={state.interests}
          onChange={(interests) => setState({ ...state, interests })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 8) {
    return (
      <OnboardingStep
        step={bar(8)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => go(false, () => ({ availability: state.availability }), 9)}
        onSkip={() => void advance({}, 9)}
      >
        <div className="space-y-2">
          <StepHeading>Коли тобі зручно?</StepHeading>
          <StepSubheading>Можна вибрати кілька.</StepSubheading>
        </div>
        <ChipMultiToggleGroup
          options={AVAILABILITY_OPTIONS}
          value={state.availability}
          onChange={(availability) => setState({ ...state, availability })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 9) {
    return (
      <OnboardingStep
        step={bar(9)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() =>
          void advance(
            { schedule_constraints: state.scheduleConstraints.trim() || null },
            10,
          )
        }
        onSkip={() => void advance({}, 10)}
      >
        <div className="space-y-2">
          <StepHeading>Що з графіку важливо врахувати?</StepHeading>
          <StepSubheading>
            Наприклад: маленька дитина, догляд за кимось, інші справи.
          </StepSubheading>
        </div>
        <Textarea
          value={state.scheduleConstraints}
          maxLength={500}
          onChange={(e) => setState({ ...state, scheduleConstraints: e.target.value })}
          rows={4}
          placeholder="напиши вільно — як зручно"
          className="border-border bg-card focus-visible:border-b-primary min-h-[120px] rounded-xl border px-3 py-3 text-base"
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 10) {
    return (
      <OnboardingStep
        step={bar(10)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() =>
          void advance({ company_preference: state.companyPreference }, 11)
        }
        onSkip={() => void advance({}, 11)}
      >
        <div className="space-y-2">
          <StepHeading>В якій компанії бути?</StepHeading>
          <StepSubheading>Один варіант. Можна змінити будь-коли.</StepSubheading>
        </div>
        <ChipSingleToggleGroup
          options={COMPANY_PREFERENCE_OPTIONS}
          value={state.companyPreference}
          onChange={(v) => v && setState({ ...state, companyPreference: v })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 11) {
    return (
      <OnboardingStep
        step={bar(11)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() =>
          void advance({ accessibility_flags: state.accessibility }, 12)
        }
        onSkip={() => void advance({}, 12)}
      >
        <div className="space-y-2">
          <StepHeading>Що важливо для комфорту?</StepHeading>
          <StepSubheading>Доступність — обери все, що для тебе має значення.</StepSubheading>
        </div>
        <ChipMultiToggleGroup
          options={ACCESSIBILITY_OPTIONS}
          value={state.accessibility}
          onChange={(accessibility) => setState({ ...state, accessibility })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 12) {
    return (
      <OnboardingStep
        step={bar(12)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() =>
          void advance({ triggers_to_avoid: state.triggers }, 13)
        }
        onSkip={() => void advance({}, 13)}
      >
        <div className="space-y-2">
          <StepHeading>Тригери, яких уникати?</StepHeading>
          <StepSubheading>Не покажемо подій, де таке буде помітно.</StepSubheading>
        </div>
        <ChipMultiToggleGroup
          options={TRIGGER_OPTIONS}
          value={state.triggers}
          onChange={(triggers) => setState({ ...state, triggers })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 13) {
    return (
      <OnboardingStep
        step={bar(13)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => void advance({ veteran_status: state.veteranStatus }, 14)}
        onSkip={() => void advance({}, 14)}
      >
        <div className="space-y-2">
          <StepHeading>Який твій статус?</StepHeading>
          <StepSubheading>Це для матчингу. Ніхто інший не побачить.</StepSubheading>
        </div>
        <ChipSingleToggleGroup
          options={VETERAN_STATUS_OPTIONS}
          value={state.veteranStatus}
          onChange={(v) => setState({ ...state, veteranStatus: v })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 14) {
    return (
      <OnboardingStep
        step={bar(14)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() =>
          void advance(
            { role_in_group: state.roleInGroup.trim() || null },
            15,
          )
        }
        onSkip={() => void advance({}, 15)}
      >
        <div className="space-y-2">
          <StepHeading>Що приносиш у збір?</StepHeading>
          <StepSubheading>Без правильних відповідей. «Просто буду» — теж валідно.</StepSubheading>
        </div>
        <ChipSingleToggleGroup
          options={ROLE_IN_GROUP_OPTIONS}
          value={state.roleInGroup || null}
          onChange={(v) => setState({ ...state, roleInGroup: v ?? "" })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 15) {
    return (
      <OnboardingStep
        step={bar(15)}
        total={total}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => void advance({ age_range: state.ageRange }, 16)}
        onSkip={() => void advance({}, 16)}
      >
        <div className="space-y-2">
          <StepHeading>Орієнтовний вік?</StepHeading>
          <StepSubheading>Допомагає зібрати схожих за віком.</StepSubheading>
        </div>
        <ChipSingleToggleGroup
          options={AGE_RANGE_OPTIONS}
          value={state.ageRange}
          onChange={(v) => setState({ ...state, ageRange: v })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  // step === 16
  return (
    <OnboardingStep
      step={bar(16)}
      total={total}
      primaryLabel="Готово"
      skipLabel="Пропустити"
      busy={busy}
      onPrimary={() =>
        void advance({ bio: state.bio.trim() || null }, "done")
      }
      onSkip={() => void advance({}, "done")}
    >
      <div className="space-y-2">
        <StepHeading>Розкажи коротко про себе</StepHeading>
        <StepSubheading>
          Кілька речень, як комфортно з тобою. Це лише для матчингу.
        </StepSubheading>
      </div>
      <Textarea
        value={state.bio}
        maxLength={500}
        onChange={(e) => setState({ ...state, bio: e.target.value })}
        rows={5}
        placeholder="наприклад, «люблю спокійні розмови, без поспіху»"
        className="border-border bg-card focus-visible:border-b-primary min-h-[140px] rounded-xl border px-3 py-3 text-base"
      />
      <p className="text-muted-foreground text-right text-xs">{state.bio.length}/500</p>
      {error ? <ErrorLine>{error}</ErrorLine> : null}
    </OnboardingStep>
  );
}

// ----------------------------------------------------------------
// Step bodies
// ----------------------------------------------------------------

function CityStep({
  value,
  onChange,
  onDetect,
  onOpenSettings,
  locating,
  locateError,
}: {
  value: string;
  onChange: (v: string) => void;
  onDetect: () => void;
  onOpenSettings: () => void;
  locating: boolean;
  locateError: string | null;
}) {
  return (
    <div className="space-y-3">
      <ToggleGroup
        type="single"
        spacing={2}
        value={NEAREST_CITIES.includes(value as (typeof NEAREST_CITIES)[number]) ? value : ""}
        onValueChange={(v) => v && onChange(v)}
        className="flex flex-wrap"
      >
        {NEAREST_CITIES.map((c) => {
          const enabled = c === ENABLED_CITY;
          return (
            <ToggleGroupItem
              key={c}
              value={c}
              variant="outline"
              disabled={!enabled}
              className={chipItemClasses}
              aria-label={enabled ? c : `${c} (поки що недоступно)`}
            >
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {c}
              {!enabled ? (
                <span className="text-muted-foreground/80 ml-1 text-xs font-normal lowercase">
                  · скоро
                </span>
              ) : null}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      <p className="text-muted-foreground text-xs">
        Зараз працюємо в Дніпрі. Інші міста — найближчим часом.
      </p>

      <div className="relative opacity-60">
        <MapPin
          className="text-muted-foreground pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="інше місто (скоро)"
          autoComplete="address-level2"
          className="h-11 rounded-xl border bg-card pl-10 pr-10"
          aria-label="Місто"
          disabled
          readOnly
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            disabled
            className="text-muted-foreground hover:bg-muted absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full disabled:opacity-50"
            aria-label="Очистити"
            style={{ touchAction: "manipulation" }}
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
      </div>

      <button
        type="button"
        onClick={onDetect}
        disabled
        className="text-muted-foreground inline-flex cursor-not-allowed items-center gap-1.5 rounded-md py-1.5 text-sm font-medium opacity-60"
        style={{ touchAction: "manipulation" }}
      >
        <LocateFixed className={cn("h-4 w-4", locating && "animate-pulse")} aria-hidden />
        Визначити автоматично · скоро
      </button>
      <LocateError error={locateError} onOpenSettings={onOpenSettings} />
    </div>
  );
}

function LocateError({
  error,
  onOpenSettings,
}: {
  error: string | null;
  onOpenSettings: () => void;
}) {
  if (!error) return null;
  if (error === "denied:tg") {
    return (
      <div className="text-destructive space-y-1 text-xs">
        <p>Telegram заблокував доступ до геолокації для цього додатка.</p>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-primary inline-flex underline-offset-2 hover:underline"
        >
          Відкрити налаштування
        </button>
      </div>
    );
  }
  if (error === "denied:browser") {
    return (
      <div className="text-destructive space-y-1 text-xs">
        <p>Браузер заблокував геолокацію.</p>
        <p className="text-muted-foreground">
          Дозволь у налаштуваннях сайту або введи місто вручну.
        </p>
      </div>
    );
  }
  if (error === "fail") {
    return <p className="text-destructive text-xs">Не вдалось визначити. Введи вручну.</p>;
  }
  return <p className="text-destructive text-xs">{error}</p>;
}

function NameStep({
  displayName,
  onDisplayName,
  showPublicly,
  onShowPublicly,
}: {
  displayName: string;
  onDisplayName: (v: string) => void;
  showPublicly: boolean;
  onShowPublicly: (v: boolean) => void;
}) {
  const trimmed = displayName.trim();
  const hasName = trimmed.length > 0;
  const mode: "anon" | "public" = hasName && showPublicly ? "public" : "anon";

  return (
    <div className="space-y-4">
      <Input
        value={displayName}
        onChange={(e) => onDisplayName(e.target.value)}
        placeholder="наприклад, Дмитро"
        maxLength={120}
        autoComplete="given-name"
        className="h-11 rounded-xl border bg-card px-3"
      />
      <RadioGroup
        value={mode}
        onValueChange={(v) => onShowPublicly(v === "public")}
        className="grid grid-cols-2 gap-2"
      >
        <ModeOption value="anon" title="Анонімно" subtitle="Видно тільки кількість" />
        <ModeOption
          value="public"
          disabled={!hasName}
          title={`Показувати «${trimmed || "ім'я"}»`}
          subtitle={hasName ? "Імʼя серед тих, хто йде" : "Спершу введи ім'я"}
        />
      </RadioGroup>
      <p className="text-muted-foreground text-xs">Для кожної події можна окремо.</p>
    </div>
  );
}

function ModeOption({
  value,
  disabled,
  title,
  subtitle,
}: {
  value: string;
  disabled?: boolean;
  title: string;
  subtitle: string;
}) {
  const id = `mode-${value}`;
  return (
    <Label
      htmlFor={id}
      className={cn(
        "border-border bg-card text-foreground hover:border-primary/40 has-[[aria-checked=true]]:border-primary has-[[aria-checked=true]]:bg-primary has-[[aria-checked=true]]:text-primary-foreground flex h-auto min-h-[64px] cursor-pointer flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-3 py-2 text-left transition",
        disabled && "cursor-not-allowed opacity-50",
      )}
      style={{ touchAction: "manipulation" }}
    >
      <RadioGroupItem id={id} value={value} disabled={disabled} className="sr-only" />
      <span className="text-sm font-semibold leading-tight">{title}</span>
      <span className="text-xs leading-tight opacity-85">{subtitle}</span>
    </Label>
  );
}

// ----------------------------------------------------------------
// New step bodies
// ----------------------------------------------------------------

function AdaptationStep({
  prefs,
  onChange,
}: {
  prefs: AppPrefs;
  onChange: (p: AppPrefs) => void;
}) {
  return (
    <div className="space-y-5">
      <FieldRow icon={<Type className="h-4 w-4" aria-hidden />} label="Розмір шрифту">
        <ToggleGroup
          type="single"
          spacing={2}
          value={prefs.fontSize}
          onValueChange={(v) => v && onChange({ ...prefs, fontSize: v as FontSize })}
          className="flex flex-wrap"
          aria-label="Розмір шрифту"
        >
          {FONT_SIZE_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              variant="outline"
              className={chipItemClasses}
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </FieldRow>

      <FieldRow
        icon={
          prefs.darkMode ? (
            <Moon className="h-4 w-4" aria-hidden />
          ) : (
            <Sun className="h-4 w-4" aria-hidden />
          )
        }
        label="Темний режим"
      >
        <SettingToggle
          checked={prefs.darkMode}
          onChange={(v) => onChange({ ...prefs, darkMode: v })}
          ariaLabel="Темний режим"
          rightLabel={prefs.darkMode ? "Увімкнено" : "Вимкнено"}
        />
      </FieldRow>

      <FieldRow icon={<Palette className="h-4 w-4" aria-hidden />} label="Палітра">
        <ToggleGroup
          type="single"
          spacing={2}
          value={prefs.palette}
          onValueChange={(v) =>
            v && onChange({ ...prefs, palette: v as ColorblindPalette })
          }
          className="flex flex-wrap"
          aria-label="Палітра кольорів"
        >
          {PALETTE_OPTIONS.map((opt) => (
            <ToggleGroupItem
              key={opt.value}
              value={opt.value}
              variant="outline"
              className={chipItemClasses}
            >
              {opt.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <p className="text-muted-foreground pt-2 text-xs">
          Адаптує основний колір під типи дальтонізму.
        </p>
      </FieldRow>

      <FieldRow icon={<Mic className="h-4 w-4" aria-hidden />} label="Голосовий ввід">
        <SettingToggle
          checked={false}
          onChange={() => undefined}
          disabled
          ariaLabel="Голосовий ввід (скоро)"
          rightLabel="Скоро"
        />
      </FieldRow>

      <FieldRow icon={<Volume2 className="h-4 w-4" aria-hidden />} label="Voice over">
        <SettingToggle
          checked={false}
          onChange={() => undefined}
          disabled
          ariaLabel="Voice over (скоро)"
          rightLabel="Скоро"
        />
      </FieldRow>

      <p className="text-muted-foreground pt-1 text-xs">
        Налаштування зберігаються та доступні в розділі профілю.
      </p>
    </div>
  );
}

function FieldRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="text-foreground inline-flex items-center gap-1.5 text-sm font-semibold">
        <span className="text-primary" aria-hidden>
          {icon}
        </span>
        {label}
      </div>
      {children}
    </div>
  );
}

function SettingToggle({
  checked,
  onChange,
  disabled,
  ariaLabel,
  rightLabel,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  ariaLabel: string;
  rightLabel?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "border-border bg-card text-foreground hover:border-primary/40 inline-flex h-11 w-full items-center justify-between rounded-xl border px-3 transition",
        disabled && "cursor-not-allowed opacity-60 hover:border-border",
      )}
      style={{ touchAction: "manipulation" }}
    >
      <span className="text-sm font-medium">{rightLabel}</span>
      <span
        aria-hidden
        className={cn(
          "relative inline-flex h-6 w-10 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-border",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 inline-block h-5 w-5 rounded-full bg-card shadow transition-all",
            checked ? "left-[18px]" : "left-0.5",
          )}
        />
      </span>
    </button>
  );
}

function HealthTriggerStep({
  value,
  onChange,
}: {
  value: boolean | null;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <TriggerCard
        active={value === true}
        title="Так"
        subtitle="Підкажемо релевантні заклади і програми"
        onSelect={() => onChange(true)}
      />
      <TriggerCard
        active={value === false}
        title="Ні"
        subtitle="Покажемо звичайну стрічку"
        onSelect={() => onChange(false)}
      />
    </div>
  );
}

function TriggerCard({
  active,
  title,
  subtitle,
  onSelect,
}: {
  active: boolean;
  title: string;
  subtitle: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "border-border bg-card text-foreground hover:border-primary/40 flex h-auto min-h-[88px] cursor-pointer flex-col items-start justify-center gap-0.5 rounded-xl border-2 px-4 py-3 text-left transition",
        active &&
          "border-primary bg-primary text-primary-foreground hover:border-primary",
      )}
      style={{ touchAction: "manipulation" }}
    >
      <span className="inline-flex items-center gap-1.5 text-sm font-semibold leading-tight">
        <Heart
          className={cn("h-3.5 w-3.5", active ? "fill-current" : "")}
          aria-hidden
        />
        {title}
      </span>
      <span className="text-xs leading-snug opacity-85">{subtitle}</span>
    </button>
  );
}

function HealthCategoryStep({
  value,
  onChange,
}: {
  value: HealthCategory | null;
  onChange: (v: HealthCategory) => void;
}) {
  return (
    <div className="space-y-2">
      <ToggleGroup
        type="single"
        spacing={2}
        value={value ?? ""}
        onValueChange={(v) => v && onChange(v as HealthCategory)}
        className="flex flex-wrap"
        aria-label="Категорія допомоги"
      >
        {HEALTH_CATEGORY_OPTIONS.map((opt) => (
          <ToggleGroupItem
            key={opt.value}
            value={opt.value}
            variant="outline"
            disabled={opt.soon}
            className={chipItemClasses}
            aria-label={opt.soon ? `${opt.label} (скоро)` : opt.label}
          >
            {opt.label}
            {opt.soon ? (
              <span className="text-muted-foreground/80 ml-1 text-xs font-normal lowercase">
                · скоро
              </span>
            ) : null}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function HealthDirectionStep({
  options,
  value,
  onChange,
}: {
  options: Option<string>[];
  value: string[];
  onChange: (v: string[]) => void;
}) {
  if (options.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Для цієї категорії напрямки скоро.
      </p>
    );
  }
  return (
    <ToggleGroup
      type="multiple"
      spacing={2}
      value={value}
      onValueChange={(v) => onChange(v)}
      className="flex flex-wrap"
      aria-label="Напрямки"
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          variant="outline"
          className={chipItemClasses}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ----------------------------------------------------------------
// Reusable bits
// ----------------------------------------------------------------

const chipItemClasses =
  "h-10 rounded-full border bg-card text-foreground px-4 text-sm font-medium normal-case tracking-normal hover:bg-card hover:border-primary/40 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

function ErrorLine({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-xl border px-3 py-2 text-sm">
      {children}
    </div>
  );
}

function ChipMultiToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T[];
  onChange: (v: T[]) => void;
}) {
  return (
    <ToggleGroup
      type="multiple"
      spacing={2}
      value={value}
      onValueChange={(v) => onChange(v as T[])}
      className="flex flex-wrap"
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          variant="outline"
          className={chipItemClasses}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function ChipSingleToggleGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      spacing={2}
      value={value ?? ""}
      onValueChange={(v) => onChange((v as T) || null)}
      className="flex flex-wrap"
    >
      {options.map((opt) => (
        <ToggleGroupItem
          key={opt.value}
          value={opt.value}
          variant="outline"
          className={chipItemClasses}
        >
          {opt.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function pickNearestCity(here: { lat: number; lng: number }): string {
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
  return bestName;
}

function browserGeolocate(): Promise<{ lat: number; lng: number } | "denied" | "fail"> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve("fail");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => resolve(err.code === err.PERMISSION_DENIED ? "denied" : "fail"),
      { timeout: 6000, maximumAge: 60_000 },
    );
  });
}
