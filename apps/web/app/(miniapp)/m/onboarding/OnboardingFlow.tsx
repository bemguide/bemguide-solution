// Three-step onboarding (city / interests / comfort). Each step calls
// /api/veteran/upsert optimistically. The final step also marks onboarded_at.

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
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
import { Input } from "@/components/ui/input";
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

const ALL_CITIES = [...DEMO_CITIES, "Харків", "Одеса", "Полтава", "Вінниця", "Луцьк", "Рівне"];

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

  // Deep-link bypass: start_param=evt_<slug>  → skip onboarding to event page.
  useEffect(() => {
    const param = getStartParam();
    if (param.startsWith("evt_")) {
      const slug = param.slice(4);
      router.replace(`/m/event/${slug}`);
      setBypassed(true);
      return;
    }
    if (param.startsWith("defer_")) {
      router.replace("/m/feed");
      setBypassed(true);
      return;
    }
    // Pre-fill from Telegram first_name/language defaults.
    const tgUser = getTgUser();
    if (tgUser.firstName && !state.city) {
      // first_name is not the city, but we keep the variable use silenced by referencing it
      // — we'll capture it by default in /api/feed when authedVeteran first sees the user.
    }
  }, [router, state.city]);

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

  const cityValid = state.city.trim().length > 0;

  return (
    <>
      {step === 1 ? (
        <OnboardingCard
          step={1}
          total={3}
          title="Де ти зараз?"
          subtitle="Щоб показати тільки те, що поруч"
          primaryLabel={cityValid ? "Далі" : "Пропустити"}
          busy={busy}
          onPrimary={() =>
            cityValid ? persistAndAdvance({ city: state.city }, 2) : persistAndAdvance({}, 2)
          }
          onSkip={() => persistAndAdvance({}, 2)}
        >
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="city">Місто</Label>
              <Input
                id="city"
                value={state.city}
                onChange={(e) => setState({ ...state, city: e.target.value })}
                placeholder="наприклад, Київ"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              {ALL_CITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setState({ ...state, city: c })}
                  className={cn(
                    "min-h-9 rounded-full border px-3 text-sm transition",
                    state.city === c
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-card text-foreground border-border hover:bg-muted",
                  )}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
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
          <InterestGrid
            value={state.interests}
            onChange={(v) => setState({ ...state, interests: v })}
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
          <ComfortSection
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

function InterestGrid({
  value,
  onChange,
}: {
  value: InterestCategory[];
  onChange: (v: InterestCategory[]) => void;
}) {
  const set = useMemo(() => new Set(value), [value]);
  return (
    <div className="grid grid-cols-2 gap-2">
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
              "min-h-12 rounded-lg border px-3 py-2 text-sm transition",
              active
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-foreground border-border hover:bg-muted",
            )}
          >
            {INTEREST_LABELS_UK[c]}
          </button>
        );
      })}
    </div>
  );
}

function ComfortSection({
  identity,
  onIdentity,
  accessibility,
  onAccessibility,
  comfort,
  onComfort,
}: {
  identity: IdentityPref;
  onIdentity: (v: IdentityPref) => void;
  accessibility: AccessibilityFlag[];
  onAccessibility: (v: AccessibilityFlag[]) => void;
  comfort: string;
  onComfort: (v: string) => void;
}) {
  const set = useMemo(() => new Set(accessibility), [accessibility]);
  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>З ким комфортно</Label>
        <div className="flex flex-wrap gap-2">
          {IDENTITY_PREFS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => onIdentity(p)}
              className={cn(
                "min-h-9 rounded-full border px-3 text-sm transition",
                identity === p
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:bg-muted",
              )}
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
            const active = set.has(f);
            return (
              <button
                key={f}
                type="button"
                onClick={() => {
                  const next = new Set(set);
                  if (active) next.delete(f);
                  else next.add(f);
                  onAccessibility([...next]);
                }}
                className={cn(
                  "min-h-9 rounded-full border px-3 text-sm transition",
                  active
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-card text-foreground border-border hover:bg-muted",
                )}
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
          className="border-input bg-card focus-visible:ring-ring min-h-[88px] w-full rounded-lg border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
        />
      </div>
    </div>
  );
}
