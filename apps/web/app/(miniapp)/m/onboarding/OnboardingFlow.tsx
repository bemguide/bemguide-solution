// Six-question onboarding (plus a Step 0 greeting) over the v2 `users`
// schema. Stripped chrome — segmented progress strip at the top, plain
// question heading, shadcn primitives for the form controls.
//
//   Step 0 — Greeting (zero-Q)
//   Step 1 — Місто (Q1)                     → users.city
//   Step 2 — Ім'я (Q2)                       → display_name + show_name_publicly
//   Step 3 — Що цікаво (Q3)                  → interests
//   Step 4 — Графік (Q4 + Q5)                → availability + schedule_constraints
//   Step 5 — Що для комфорту (Q6 + Q7 + Q8)   → company_preference + accessibility_flags + triggers_to_avoid
//   Step 6 — Про тебе (Q9 + Q10 + Q11 + Q12)   → veteran_status + age_range + role_in_group + bio
//
// Each step PATCHes /me with its slice; the backend's
// users_match_recompute trigger fans the change into event_matches so
// the next /feed is already personalised.
//
// Deep-link bypass:
//   evt_<id>   → /m/event/<id>
//   defer_<id> → /m/feed

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { LocateFixed, MapPin, X } from "lucide-react";
import { DEMO_CITIES } from "@poruch/shared";
import {
  FieldLabel,
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
  getTgUser,
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
type StepIndex = 0 | 1 | 2 | 3 | 4 | 5 | 6;

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
  const [step, setStep] = useState<StepIndex>(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bypassed, setBypassed] = useState(false);
  const [state, setState] = useState<FormState>(initialState);

  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<string | null>(null);

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
    const tg = getTgUser();
    if (tg.firstName) setState((s) => ({ ...s, displayName: tg.firstName ?? "" }));
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

  function commitStep0() {
    void advance(null, 1);
  }

  function commitStep1(skip = false) {
    void advance(skip || !state.city.trim() ? {} : { city: state.city.trim() }, 2);
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

  if (step === 0) {
    return (
      <OnboardingStep
        step={0}
        total={TOTAL_STEPS}
        primaryLabel="Подивитись поруч"
        busy={busy}
        onPrimary={commitStep0}
      >
        <div className="space-y-4 pt-2">
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
        step={1}
        total={TOTAL_STEPS}
        primaryLabel="Далі"
        skipLabel="Не зараз, тільки гляну"
        busy={busy}
        onPrimary={() => commitStep1(false)}
        onSkip={() => commitStep1(true)}
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
        step={2}
        total={TOTAL_STEPS}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => commitStep2(false)}
        onSkip={() => commitStep2(true)}
      >
        <div className="space-y-2">
          <StepHeading>Як до тебе звертатися?</StepHeading>
          <StepSubheading>
            Можна анонімно — інші бачитимуть тільки кількість.
          </StepSubheading>
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

  if (step === 3) {
    return (
      <OnboardingStep
        step={3}
        total={TOTAL_STEPS}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => commitStep3(false)}
        onSkip={() => commitStep3(true)}
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

  if (step === 4) {
    return (
      <OnboardingStep
        step={4}
        total={TOTAL_STEPS}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => commitStep4(false)}
        onSkip={() => commitStep4(true)}
      >
        <div className="space-y-2">
          <StepHeading>Коли тобі зручно?</StepHeading>
          <StepSubheading>Що з графіку важливо врахувати?</StepSubheading>
        </div>
        <ScheduleStep
          availability={state.availability}
          onAvailability={(availability) => setState({ ...state, availability })}
          constraints={state.scheduleConstraints}
          onConstraints={(scheduleConstraints) => setState({ ...state, scheduleConstraints })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  if (step === 5) {
    return (
      <OnboardingStep
        step={5}
        total={TOTAL_STEPS}
        primaryLabel="Далі"
        skipLabel="Пропустити"
        busy={busy}
        onPrimary={() => commitStep5(false)}
        onSkip={() => commitStep5(true)}
      >
        <div className="space-y-2">
          <StepHeading>Що важливо для комфорту?</StepHeading>
          <StepSubheading>Усе опційно — і можна змінити будь-коли.</StepSubheading>
        </div>
        <ComfortStep
          companyPreference={state.companyPreference}
          onCompanyPreference={(companyPreference) => setState({ ...state, companyPreference })}
          accessibility={state.accessibility}
          onAccessibility={(accessibility) => setState({ ...state, accessibility })}
          triggers={state.triggers}
          onTriggers={(triggers) => setState({ ...state, triggers })}
        />
        {error ? <ErrorLine>{error}</ErrorLine> : null}
      </OnboardingStep>
    );
  }

  return (
    <OnboardingStep
      step={6}
      total={TOTAL_STEPS}
      primaryLabel="Готово"
      skipLabel="Пропустити"
      busy={busy}
      onPrimary={() => commitStep6(false)}
      onSkip={() => commitStep6(true)}
    >
      <div className="space-y-2">
        <StepHeading>Останнє — про тебе</StepHeading>
        <StepSubheading>Це для матчингу. Ніхто інший не побачить.</StepSubheading>
      </div>
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
        {NEAREST_CITIES.map((c) => (
          <ToggleGroupItem
            key={c}
            value={c}
            variant="outline"
            className={chipItemClasses}
            aria-label={c}
          >
            <MapPin className="h-3.5 w-3.5" aria-hidden />
            {c}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      <div className="relative">
        <MapPin
          className="text-muted-foreground pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2"
          aria-hidden
        />
        <Input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="інше місто"
          autoComplete="address-level2"
          className="h-11 rounded-xl border bg-card pl-10 pr-10"
          aria-label="Місто"
        />
        {value ? (
          <button
            type="button"
            onClick={() => onChange("")}
            className="text-muted-foreground hover:bg-muted absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full"
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
        disabled={locating}
        className="text-primary inline-flex items-center gap-1.5 rounded-md py-1.5 text-sm font-medium underline-offset-2 hover:underline disabled:opacity-60"
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
    <div className="space-y-4">
      <ChipMultiToggleGroup
        options={AVAILABILITY_OPTIONS}
        value={availability}
        onChange={onAvailability}
      />
      <div className="space-y-2">
        <FieldLabel>Що з графіку врахувати</FieldLabel>
        <Textarea
          value={constraints}
          maxLength={500}
          onChange={(e) => onConstraints(e.target.value)}
          rows={3}
          placeholder="наприклад, «маленька дитина — не цілий день»"
          className="border-border bg-card focus-visible:border-b-primary min-h-[88px] rounded-xl border px-3 py-2 text-base"
        />
      </div>
    </div>
  );
}

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
      <div className="space-y-2">
        <FieldLabel>В якій компанії бути</FieldLabel>
        <ChipSingleToggleGroup
          options={COMPANY_PREFERENCE_OPTIONS}
          value={companyPreference}
          onChange={(v) => v && onCompanyPreference(v)}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel>Доступність</FieldLabel>
        <ChipMultiToggleGroup
          options={ACCESSIBILITY_OPTIONS}
          value={accessibility}
          onChange={onAccessibility}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel>Тригери, яких уникати</FieldLabel>
        <ChipMultiToggleGroup
          options={TRIGGER_OPTIONS}
          value={triggers}
          onChange={onTriggers}
        />
      </div>
    </div>
  );
}

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
      <div className="space-y-2">
        <FieldLabel>Статус</FieldLabel>
        <ChipSingleToggleGroup
          options={VETERAN_STATUS_OPTIONS}
          value={veteranStatus}
          onChange={onVeteranStatus}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel>Вік</FieldLabel>
        <ChipSingleToggleGroup options={AGE_RANGE_OPTIONS} value={ageRange} onChange={onAgeRange} />
      </div>
      <div className="space-y-2">
        <FieldLabel>Що приносиш у збір</FieldLabel>
        <ChipSingleToggleGroup
          options={ROLE_IN_GROUP_OPTIONS}
          value={role || null}
          onChange={(v) => onRole(v ?? "")}
        />
      </div>
      <div className="space-y-2">
        <FieldLabel>Про себе (вільно)</FieldLabel>
        <Textarea
          value={bio}
          maxLength={500}
          onChange={(e) => onBio(e.target.value)}
          rows={4}
          placeholder="кілька речень — як комфортно з тобою, що тобі важливо"
          className="border-border bg-card focus-visible:border-b-primary min-h-[100px] rounded-xl border px-3 py-2 text-base"
        />
        <p className="text-muted-foreground text-right text-xs">{bio.length}/500</p>
      </div>
    </div>
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
