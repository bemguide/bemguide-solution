// Six-step onboarding that captures all 12 v2 user fields:
//
//   Step 1 — Місто               → users.city
//   Step 2 — Як звертатися         → users.display_name + users.show_name_publicly
//   Step 3 — Інтереси             → users.interests
//   Step 4 — Графік               → users.availability + users.schedule_constraints
//   Step 5 — Що для комфорту       → users.company_preference
//                                  + users.accessibility_flags
//                                  + users.triggers_to_avoid
//   Step 6 — Про тебе              → users.veteran_status + users.age_range
//                                  + users.role_in_group + users.bio
//
// Each step PATCHes /me with its slice. The backend's
// users_match_recompute trigger rebuilds event_matches under the hood,
// so the next /feed fetch is already personalised.
//
// Deep-link bypass kept verbatim from the v1 lane:
//   - `evt_<id>`   → skip onboarding to /m/event/<id>
//   - `defer_<id>` → skip onboarding to /m/feed

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, MapPin, X } from "lucide-react";
import { DEMO_CITIES } from "@poruch/shared";
import { OnboardingCard } from "@/components/poruch/OnboardingCard";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getStartParam,
  getTgUser,
  tgGetLocation,
  tgLocationDenied,
  tgOpenLocationSettings,
} from "@/lib/telegram/client";
import { cn } from "@/lib/utils";
import {
  describeError,
  updateCurrentUser,
  type AccessibilityFlag,
  type AgeRange,
  type CompanyPreference,
  type UserPatch,
  type VeteranStatus,
} from "@/lib/api";
import {
  ACCESSIBILITY_OPTIONS,
  AGE_RANGE_OPTIONS,
  AVAILABILITY_OPTIONS,
  COMPANY_PREFERENCE_OPTIONS,
  INTEREST_OPTIONS,
  ROLE_IN_GROUP_OPTIONS,
  TRIGGER_OPTIONS,
  VETERAN_STATUS_OPTIONS,
  type Option,
} from "./options";

const TOTAL_STEPS = 6;

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

type FormState = {
  // Step 1
  city: string;
  // Step 2
  displayName: string;
  showNamePublicly: boolean;
  // Step 3
  interests: string[];
  // Step 4
  availability: string[];
  scheduleConstraints: string;
  // Step 5
  companyPreference: CompanyPreference;
  accessibility: AccessibilityFlag[];
  triggers: string[];
  // Step 6
  veteranStatus: VeteranStatus | null;
  ageRange: AgeRange | null;
  roleInGroup: string;
  bio: string;
};

const initialState: FormState = {
  city: "",
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

export function OnboardingFlow() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [state, setState] = useState<FormState>(initialState);

  // Step 1 state — geolocation UI.
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

  // Deep-link bypass.
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
    // Pre-fill display_name from Telegram first_name (user can edit on Step 2).
    const tg = getTgUser();
    if (tg.firstName) setState((s) => ({ ...s, displayName: tg.firstName ?? "" }));
  }, [router]);

  if (bypassed) return null;

  async function persist(patch: UserPatch): Promise<boolean> {
    try {
      await updateCurrentUser(patch);
      return true;
    } catch (e) {
      // Non-fatal: log + show but let the user keep going.
      // Onboarding is skip-able; we don't gate forward navigation
      // behind a backend hiccup.
      console.warn("[onboarding] patch failed:", e);
      setError(describeError(e, "onboarding"));
      return false;
    }
  }

  async function advance(patch: UserPatch | null, next: typeof step | "done") {
    setBusy(true);
    setError(null);
    try {
      if (patch && Object.keys(patch).length > 0) {
        await persist(patch);
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

  // ----- Step handlers (each builds its own patch) -----

  function commitStep1(skip = false) {
    const patch: UserPatch = skip || !state.city.trim() ? {} : { city: state.city.trim() };
    void advance(patch, 2);
  }

  function commitStep2(skip = false) {
    if (skip) return void advance({}, 3);
    const name = state.displayName.trim();
    void advance(
      {
        display_name: name || null,
        show_name_publicly: name ? state.showNamePublicly : false,
      },
      3,
    );
  }

  function commitStep3(skip = false) {
    void advance(skip ? {} : { interests: state.interests }, 4);
  }

  function commitStep4(skip = false) {
    if (skip) return void advance({}, 5);
    const constraints = state.scheduleConstraints.trim();
    void advance(
      {
        availability: state.availability,
        schedule_constraints: constraints || null,
      },
      5,
    );
  }

  function commitStep5(skip = false) {
    if (skip) return void advance({}, 6);
    void advance(
      {
        company_preference: state.companyPreference,
        accessibility_flags: state.accessibility,
        triggers_to_avoid: state.triggers,
      },
      6,
    );
  }

  function commitStep6(skip = false) {
    if (skip) return void advance({}, "done");
    const role = state.roleInGroup.trim();
    const bio = state.bio.trim();
    void advance(
      {
        veteran_status: state.veteranStatus,
        age_range: state.ageRange,
        role_in_group: role || null,
        bio: bio || null,
      },
      "done",
    );
  }

  // ----- Step 1 geolocation handlers -----

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

  return (
    <>
      {error ? (
        <div className="bg-destructive/10 text-destructive border-destructive/30 mx-4 mt-2 rounded-md border px-3 py-2 text-sm">
          {error}
        </div>
      ) : null}

      {step === 1 ? (
        <OnboardingCard
          step={1}
          total={TOTAL_STEPS}
          title="Де ти зараз?"
          subtitle="Щоб показати тільки те, що поруч."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() => commitStep1(false)}
          onSkip={() => commitStep1(true)}
        >
          <CityStep
            value={state.city}
            onChange={(city) => setState({ ...state, city })}
            onDetect={() => void detectLocation()}
            onOpenSettings={tgOpenLocationSettings}
            locating={locating}
            locateError={locateError}
          />
        </OnboardingCard>
      ) : null}

      {step === 2 ? (
        <OnboardingCard
          step={2}
          total={TOTAL_STEPS}
          title="Як до тебе звертатися?"
          subtitle="Можна анонімно — інші бачитимуть тільки кількість, не імена."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() => commitStep2(false)}
          onSkip={() => commitStep2(true)}
        >
          <NameStep
            displayName={state.displayName}
            onDisplayName={(displayName) => setState({ ...state, displayName })}
            showPublicly={state.showNamePublicly}
            onShowPublicly={(showNamePublicly) => setState({ ...state, showNamePublicly })}
          />
        </OnboardingCard>
      ) : null}

      {step === 3 ? (
        <OnboardingCard
          step={3}
          total={TOTAL_STEPS}
          title="Що цікаво?"
          subtitle="Кілька — або жодного. Все одно покажемо щось поруч."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() => commitStep3(false)}
          onSkip={() => commitStep3(true)}
        >
          <ChipMultiSelect
            options={INTEREST_OPTIONS}
            value={state.interests}
            onChange={(interests) => setState({ ...state, interests })}
            emptyHint="Нічого не вибрано — це нормально."
          />
        </OnboardingCard>
      ) : null}

      {step === 4 ? (
        <OnboardingCard
          step={4}
          total={TOTAL_STEPS}
          title="Коли тобі зручно?"
          subtitle="Допоможе підбирати події під твій ритм."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() => commitStep4(false)}
          onSkip={() => commitStep4(true)}
        >
          <ScheduleStep
            availability={state.availability}
            onAvailability={(availability) => setState({ ...state, availability })}
            constraints={state.scheduleConstraints}
            onConstraints={(scheduleConstraints) =>
              setState({ ...state, scheduleConstraints })
            }
          />
        </OnboardingCard>
      ) : null}

      {step === 5 ? (
        <OnboardingCard
          step={5}
          total={TOTAL_STEPS}
          title="Що важливо для комфорту?"
          subtitle="Усе опційно. Можна змінити будь-коли."
          primaryLabel="Далі"
          busy={busy}
          onPrimary={() => commitStep5(false)}
          onSkip={() => commitStep5(true)}
        >
          <ComfortStep
            companyPreference={state.companyPreference}
            onCompanyPreference={(companyPreference) =>
              setState({ ...state, companyPreference })
            }
            accessibility={state.accessibility}
            onAccessibility={(accessibility) => setState({ ...state, accessibility })}
            triggers={state.triggers}
            onTriggers={(triggers) => setState({ ...state, triggers })}
          />
        </OnboardingCard>
      ) : null}

      {step === 6 ? (
        <OnboardingCard
          step={6}
          total={TOTAL_STEPS}
          title="Про тебе"
          subtitle="Це для матчингу — нікому не показуємо без твого дозволу."
          primaryLabel="Готово"
          busy={busy}
          onPrimary={() => commitStep6(false)}
          onSkip={() => commitStep6(true)}
        >
          <AboutStep
            veteranStatus={state.veteranStatus}
            onVeteranStatus={(veteranStatus) => setState({ ...state, veteranStatus })}
            ageRange={state.ageRange}
            onAgeRange={(ageRange) => setState({ ...state, ageRange })}
            role={state.roleInGroup}
            onRole={(roleInGroup) => setState({ ...state, roleInGroup })}
            bio={state.bio}
            onBio={(bio) => setState({ ...state, bio })}
          />
        </OnboardingCard>
      ) : null}
    </>
  );
}

// ----------------------------------------------------------------
// Helpers shared by step handlers
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

// ----------------------------------------------------------------
// Step 1 — City picker
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
          className="text-primary inline-flex items-center underline-offset-2 hover:underline"
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

// ----------------------------------------------------------------
// Step 2 — Display name + privacy toggle
// ----------------------------------------------------------------

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
  // Public visibility requires *both* a name *and* the toggle on. Toggling
  // anonymous flips the bit; toggling visible needs a non-empty name.
  const mode: "anon" | "public" = hasName && showPublicly ? "public" : "anon";

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="dn">Ім'я</Label>
        <Input
          id="dn"
          value={displayName}
          onChange={(e) => onDisplayName(e.target.value)}
          placeholder="наприклад, Дмитро"
          maxLength={120}
          autoComplete="given-name"
        />
      </div>

      <div className="space-y-2">
        <Label>Як показувати в подіях</Label>
        <div className="grid grid-cols-2 gap-2">
          <ModeChip
            active={mode === "anon"}
            onClick={() => onShowPublicly(false)}
            title="Анонімно"
            subtitle="Видно тільки кількість"
          />
          <ModeChip
            active={mode === "public"}
            disabled={!hasName}
            onClick={() => onShowPublicly(true)}
            title={`Показувати «${trimmed || "ім'я"}»`}
            subtitle={
              hasName ? "Імʼя серед тих, хто йде" : "Спершу введи ім'я вище"
            }
          />
        </div>
        <p className="text-muted-foreground text-xs">
          Можна змінити окремо для кожної події.
        </p>
      </div>
    </div>
  );
}

function ModeChip({
  active,
  disabled,
  onClick,
  title,
  subtitle,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      style={{ touchAction: "manipulation" }}
      className={cn(
        "flex h-auto min-h-[72px] flex-col items-start justify-center gap-1 rounded-xl border-2 px-3 py-2.5 text-left transition",
        active
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border bg-card text-foreground hover:border-primary/40",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <span className="text-sm font-semibold leading-tight">{title}</span>
      <span
        className={cn(
          "text-xs leading-tight",
          active ? "text-primary-foreground/85" : "text-muted-foreground",
        )}
      >
        {subtitle}
      </span>
    </button>
  );
}

// ----------------------------------------------------------------
// Step 4 — Schedule
// ----------------------------------------------------------------

function ScheduleStep({
  availability,
  onAvailability,
  constraints,
  onConstraints,
}: {
  availability: string[];
  onAvailability: (v: string[]) => void;
  constraints: string;
  onConstraints: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <ChipMultiSelect
        options={AVAILABILITY_OPTIONS}
        value={availability}
        onChange={onAvailability}
        size="md"
      />
      <div className="space-y-2">
        <Label htmlFor="constraints">Що з графіку важливо врахувати?</Label>
        <textarea
          id="constraints"
          value={constraints}
          maxLength={500}
          onChange={(e) => onConstraints(e.target.value)}
          rows={3}
          placeholder="наприклад, «маленька дитина — не цілий день»"
          className="border-border bg-card focus-visible:border-primary focus-visible:ring-primary/20 min-h-[88px] w-full rounded-xl border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
        />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// Step 5 — Comfort: company / accessibility / triggers
// ----------------------------------------------------------------

function ComfortStep({
  companyPreference,
  onCompanyPreference,
  accessibility,
  onAccessibility,
  triggers,
  onTriggers,
}: {
  companyPreference: CompanyPreference;
  onCompanyPreference: (v: CompanyPreference) => void;
  accessibility: AccessibilityFlag[];
  onAccessibility: (v: AccessibilityFlag[]) => void;
  triggers: string[];
  onTriggers: (v: string[]) => void;
}) {
  return (
    <div className="space-y-5">
      <SubSection title="В якій компанії бути?">
        <ChipSingleSelect
          options={COMPANY_PREFERENCE_OPTIONS}
          value={companyPreference}
          onChange={(v) => v && onCompanyPreference(v)}
        />
      </SubSection>
      <SubSection title="Доступність">
        <ChipMultiSelect options={ACCESSIBILITY_OPTIONS} value={accessibility} onChange={onAccessibility} />
      </SubSection>
      <SubSection title="Тригери, яких уникати">
        <ChipMultiSelect options={TRIGGER_OPTIONS} value={triggers} onChange={onTriggers} />
      </SubSection>
    </div>
  );
}

// ----------------------------------------------------------------
// Step 6 — About: status / age / role / bio
// ----------------------------------------------------------------

function AboutStep({
  veteranStatus,
  onVeteranStatus,
  ageRange,
  onAgeRange,
  role,
  onRole,
  bio,
  onBio,
}: {
  veteranStatus: VeteranStatus | null;
  onVeteranStatus: (v: VeteranStatus | null) => void;
  ageRange: AgeRange | null;
  onAgeRange: (v: AgeRange | null) => void;
  role: string;
  onRole: (v: string) => void;
  bio: string;
  onBio: (v: string) => void;
}) {
  return (
    <div className="space-y-5">
      <SubSection title="Статус">
        <ChipSingleSelect
          options={VETERAN_STATUS_OPTIONS}
          value={veteranStatus}
          onChange={onVeteranStatus}
          allowDeselect
        />
      </SubSection>
      <SubSection title="Вік">
        <ChipSingleSelect
          options={AGE_RANGE_OPTIONS}
          value={ageRange}
          onChange={onAgeRange}
          allowDeselect
        />
      </SubSection>
      <SubSection title="Що приносиш у збір?">
        <ChipSingleSelect
          options={ROLE_IN_GROUP_OPTIONS}
          value={role || null}
          onChange={(v) => onRole(v ?? "")}
          allowDeselect
        />
      </SubSection>
      <SubSection title="Про себе">
        <textarea
          value={bio}
          maxLength={500}
          onChange={(e) => onBio(e.target.value)}
          rows={4}
          placeholder="у вільній формі — кілька речень, які ти хотів би, щоб про тебе знали"
          className="border-border bg-card focus-visible:border-primary focus-visible:ring-primary/20 min-h-[100px] w-full rounded-xl border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
        />
        <p className="text-muted-foreground text-right text-xs">{bio.length}/500</p>
      </SubSection>
    </div>
  );
}

// ----------------------------------------------------------------
// Reusable bits
// ----------------------------------------------------------------

function SubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label>{title}</Label>
      {children}
    </div>
  );
}

function ChipMultiSelect<T extends string>({
  options,
  value,
  onChange,
  emptyHint,
  size = "sm",
}: {
  options: Option<T>[];
  value: T[];
  onChange: (v: T[]) => void;
  emptyHint?: string;
  size?: "sm" | "md";
}) {
  const set = useMemo(() => new Set(value), [value]);
  const baseClass =
    size === "md"
      ? "inline-flex h-11 items-center rounded-full border-2 px-5 text-sm font-medium transition"
      : "inline-flex h-9 items-center rounded-full border px-3 text-sm transition";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = set.has(opt.value);
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => {
                const next = new Set(set);
                if (active) next.delete(opt.value);
                else next.add(opt.value);
                onChange([...next]);
              }}
              className={cn(
                baseClass,
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-foreground hover:border-primary/40",
              )}
              style={{ touchAction: "manipulation" }}
              aria-pressed={active}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      {emptyHint && value.length === 0 ? (
        <p className="text-muted-foreground text-xs">{emptyHint}</p>
      ) : null}
    </div>
  );
}

function ChipSingleSelect<T extends string>({
  options,
  value,
  onChange,
  allowDeselect = false,
}: {
  options: Option<T>[];
  value: T | null;
  onChange: (v: T | null) => void;
  allowDeselect?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(active && allowDeselect ? null : opt.value)}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3 text-sm transition",
              active
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:border-primary/40",
            )}
            style={{ touchAction: "manipulation" }}
            aria-pressed={active}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
