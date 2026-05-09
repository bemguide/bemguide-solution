// Structured event submission. Direct POST /opportunities — there is no
// NL parse step on the v2 backend, so we collect the fields the backend
// validates against (title, city, lat/lng, start_at) and post them.
//
// The backend has no moderation gate: as soon as POST returns the row
// is in `opportunities` and the recompute trigger has fanned out
// `event_matches`. The user lands on the new event page immediately.

"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { cn } from "@/lib/utils";
import { createOpportunity, describeError, getCurrentUser, logApiError } from "@/lib/api";

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

/** Demo restriction: only Дніпро is wired end-to-end against the seed. */
const ENABLED_CITY = "Дніпро";

type FormState = {
  title: string;
  description: string;
  city: string;
  address: string;
  date: string; // YYYY-MM-DD
  time: string; // HH:MM
  durationMin: number;
  priceUah: number;
  organizerContact: string;
  identity: IdentityPref;
  interests: InterestCategory[];
  accessibility: AccessibilityFlag[];
};

const DEFAULT_DURATION = 90;
const DEFAULT_CITY = ENABLED_CITY;

export function ProposeFlow() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);
  const [form, setForm] = useState<FormState>({
    title: "",
    description: "",
    city: DEFAULT_CITY,
    address: "",
    date: "",
    time: "",
    durationMin: DEFAULT_DURATION,
    priceUah: 0,
    organizerContact: "",
    identity: "any",
    interests: [],
    accessibility: [],
  });

  // Pre-fill the city from the user's profile.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const me = await getCurrentUser().catch(() => null);
        if (cancelled) return;
        if (me?.city) setForm((f) => ({ ...f, city: me.city ?? DEFAULT_CITY }));
      } catch {
        // ignore — falls back to defaults.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const interestSet = useMemo(() => new Set(form.interests), [form.interests]);
  const accSet = useMemo(() => new Set(form.accessibility), [form.accessibility]);

  function buildStartAt(): string | null {
    if (!form.date || !form.time) return null;
    // Wall-clock + Europe/Kyiv offset. Backend strips the offset on insert
    // but we send it explicitly so DST is handled correctly.
    return `${form.date}T${form.time}:00+03:00`;
  }

  function validate(): string | null {
    if (!form.title.trim()) return "Назва обов'язкова.";
    if (form.title.length > 200) return "Назва задовга — макс 200 знаків.";
    if (!form.city.trim()) return "Місто обов'язкове.";
    if (!form.date || !form.time) return "Дата і час обов'язкові.";
    return null;
  }

  async function onSubmit() {
    const v = validate();
    if (v) {
      setError(v);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const coords = CITY_COORDS[form.city] ?? CITY_COORDS[DEFAULT_CITY]!;
      const opp = await createOpportunity({
        title: form.title.trim(),
        description: form.description.trim() || null,
        city: form.city.trim(),
        address: form.address.trim() || null,
        location_lat: coords.lat,
        location_lng: coords.lng,
        start_at: buildStartAt(),
        duration_min: form.durationMin || DEFAULT_DURATION,
        interests: form.interests as unknown as string[],
        accessibility_flags: form.accessibility,
        price_uah: form.priceUah > 0 ? form.priceUah : null,
        organizer_contact: form.organizerContact.trim() || null,
        target_age_range: [],
        target_identity_pref: form.identity,
        target_veteran_status: [],
      });
      setSubmitted({ id: opp.id });
    } catch (e) {
      logApiError("propose", e);
      setError(describeError(e, "propose"));
    } finally {
      setBusy(false);
    }
  }

  if (submitted) {
    return (
      <main className="flex flex-1 flex-col gap-6 px-6 py-10 text-center">
        <h1 className="text-foreground text-2xl font-semibold">Опубліковано.</h1>
        <p className="text-muted-foreground">
          Подія вже у стрічці у людей з твого міста.
        </p>
        <div className="flex flex-col gap-2">
          <Button asChild className="mx-auto h-12">
            <Link href={`/m/event/${submitted.id}`}>До події</Link>
          </Button>
          <Button asChild variant="outline" className="mx-auto h-12">
            <Link href="/m/feed">До стрічки</Link>
          </Button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="border-border flex items-center gap-2 border-b px-4 py-3">
        <button
          type="button"
          onClick={() => router.push("/m/feed")}
          aria-label="Назад"
          className="text-muted-foreground hover:bg-muted -ml-2 inline-flex h-9 w-9 items-center justify-center rounded-full"
        >
          <ArrowLeft className="h-5 w-5" aria-hidden />
        </button>
        <h1 className="text-foreground text-lg font-semibold">Запропонувати подію</h1>
      </header>

      <form
        className="flex-1 space-y-5 overflow-y-auto px-4 pb-32 pt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void onSubmit();
        }}
      >
        <Section title="Що це">
          <div className="space-y-2">
            <Label htmlFor="title">Назва</Label>
            <Input
              id="title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="наприклад, шахи в суботу"
              maxLength={200}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="description">Опис (необов'язково)</Label>
            <textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={2000}
              rows={4}
              placeholder="Кілька слів про те, що буде."
              className="border-border bg-card focus-visible:border-primary focus-visible:ring-primary/20 min-h-[100px] w-full rounded-xl border px-3 py-2 text-base focus-visible:outline-none focus-visible:ring-2"
            />
          </div>
        </Section>

        <Section title="Де">
          <div className="space-y-2">
            <Label htmlFor="city">Місто</Label>
            <div className="flex flex-wrap gap-2">
              {DEMO_CITIES.map((c) => {
                const enabled = c === ENABLED_CITY;
                const active = form.city === c;
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => enabled && setForm((f) => ({ ...f, city: c }))}
                    disabled={!enabled}
                    aria-pressed={active}
                    className={cn(
                      "inline-flex h-10 items-center gap-1.5 rounded-full border px-4 text-sm transition",
                      active
                        ? "border-primary bg-accent text-primary"
                        : "border-border bg-card text-foreground hover:border-primary/40",
                      !enabled && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <MapPin className="h-3.5 w-3.5" aria-hidden />
                    {c}
                    {!enabled ? (
                      <span className="text-muted-foreground/80 ml-1 text-xs font-normal lowercase">
                        · скоро
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <p className="text-muted-foreground text-xs">
              Зараз приймаємо події тільки в Дніпрі.
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="address">Адреса (необов'язково)</Label>
            <Input
              id="address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              placeholder="наприклад, бібліотека ім. Лесі Українки, вул. Грушевського 5"
              maxLength={200}
            />
          </div>
        </Section>

        <Section title="Коли">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="date">Дата</Label>
              <Input
                id="date"
                type="date"
                value={form.date}
                onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Час</Label>
              <Input
                id="time"
                type="time"
                value={form.time}
                onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="duration">Тривалість, хв</Label>
            <Input
              id="duration"
              type="number"
              min={15}
              max={600}
              value={form.durationMin}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  durationMin: Number(e.target.value) || DEFAULT_DURATION,
                }))
              }
            />
          </div>
        </Section>

        <Section title="Деталі">
          <div className="space-y-2">
            <Label htmlFor="price">Ціна, ₴ (0 = безкоштовно)</Label>
            <Input
              id="price"
              type="number"
              min={0}
              max={100000}
              value={form.priceUah}
              onChange={(e) => setForm((f) => ({ ...f, priceUah: Number(e.target.value) || 0 }))}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organizer">Контакт організатора (необов'язково)</Label>
            <Input
              id="organizer"
              value={form.organizerContact}
              onChange={(e) => setForm((f) => ({ ...f, organizerContact: e.target.value }))}
              placeholder="@telegram або +380…"
            />
          </div>
        </Section>

        <Section title="Категорії">
          <div className="flex flex-wrap gap-2">
            {INTEREST_CATEGORIES.map((c) => {
              const active = interestSet.has(c);
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => {
                    const next = new Set(interestSet);
                    if (active) next.delete(c);
                    else next.add(c);
                    setForm((f) => ({ ...f, interests: [...next] }));
                  }}
                  className={cn(
                    "inline-flex h-10 items-center rounded-full border px-4 text-sm transition",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                  aria-pressed={active}
                >
                  {INTEREST_LABELS_UK[c]}
                </button>
              );
            })}
          </div>
        </Section>

        <Section title="Для кого">
          <div className="flex flex-wrap gap-2">
            {IDENTITY_PREFS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setForm((f) => ({ ...f, identity: p }))}
                className={cn(
                  "inline-flex h-9 items-center rounded-full border px-3 text-sm transition",
                  form.identity === p
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-card text-foreground hover:border-primary/40",
                )}
                aria-pressed={form.identity === p}
              >
                {IDENTITY_LABELS_UK[p]}
              </button>
            ))}
          </div>
        </Section>

        <Section title="Доступність">
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
                    setForm((s) => ({ ...s, accessibility: [...next] }));
                  }}
                  className={cn(
                    "inline-flex h-9 items-center rounded-full border px-3 text-sm transition",
                    active
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border bg-card text-foreground hover:border-primary/40",
                  )}
                  aria-pressed={active}
                >
                  {ACCESSIBILITY_LABELS_UK[f]}
                </button>
              );
            })}
          </div>
        </Section>

        {error ? <p className="text-destructive text-sm">{error}</p> : null}
      </form>

      <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full text-base font-semibold"
          onClick={() => void onSubmit()}
          disabled={busy}
        >
          {busy ? "Публікую…" : "Опублікувати"}
        </Button>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-foreground text-base font-semibold">{title}</h2>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
