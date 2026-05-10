// Structured event submission. Direct POST /opportunities — there is no
// NL parse step on the v2 backend, so we collect the fields the backend
// validates against (title, city, lat/lng, start_at) and post them.
//
// The backend has no moderation gate: as soon as POST returns the row
// is in `opportunities` and the recompute trigger has fanned out
// `event_matches`. The user lands on the new event page immediately.
//
// Layout: no custom top header — the bottom tab "Запропонувати" already
// identifies the screen, matching /m/feed and /m/me. Form sections use
// the shared `SectionHeader`; inputs and chips use the onboarding's
// card-shaped styling so the surface reads as one consistent app.
//
// Location: lat/lng comes from a required pin on an inline Leaflet map
// bounded to the selected city. Pin can be set by tapping the map,
// dragging the existing pin, or tapping "моя локація" (which uses
// Telegram's LocationManager when available, browser geolocation
// otherwise). The map component is dynamically imported with
// `ssr: false` so Leaflet ships only to the proposer surface.
//
// Accessibility:
//   - inputMode + autoComplete hints surface the right mobile keyboard.
//   - validate() returns {field, message}; on error we focus + scroll
//     the offending field into view so the user lands on it directly.
//   - aria-required / aria-invalid / aria-describedby on each input;
//     hint text gets a stable id and is announced as part of the field.
//   - The error region is role="alert" so screen readers announce on
//     submit failure.
//   - aria-busy on the form while publishing.

"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { MapPin, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SectionHeader } from "@/components/poruch/SectionHeader";
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
import { createOpportunity, describeError, getCurrentUser, logApiError } from "@/lib/api";
import {
  getTgUserWithWait,
  tgGetLocation,
  tgLocationDenied,
  tgOpenLocationSettings,
} from "@/lib/telegram/client";
import { isWithinCityBounds } from "@/lib/cities";
import { reverseGeocode } from "@/lib/geocode";

// Leaflet bundles ~42KB gz of JS + 13KB of CSS — split it off the
// onboarding/feed/me surfaces so only proposers pay for it.
const MapPicker = dynamic(
  () => import("@/components/poruch/MapPicker").then((m) => m.MapPicker),
  {
    ssr: false,
    loading: () => (
      <div
        className="bg-muted h-56 w-full animate-pulse rounded-xl"
        aria-hidden
      />
    ),
  },
);

/** Demo restriction: only Дніпро is wired end-to-end against the seed. */
const ENABLED_CITY = "Дніпро";

const DESCRIPTION_MAX = 2000;

type Pin = { lat: number; lng: number };

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
  pin: Pin | null;
};

type FieldError = { field: keyof FormState | null; message: string };

type LocateError =
  | "denied:tg"
  | "denied:browser"
  | "out_of_city"
  | "fail"
  | null;

const DEFAULT_DURATION = 90;
const DEFAULT_CITY = ENABLED_CITY;

// Card-shaped field — overrides Input's default bottom-line-only style so
// the title field is as visible as the description box. Mirrors what
// /m/onboarding uses for every input in the flow.
const inputClasses =
  "h-11 rounded-xl border bg-card px-3 aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20";
const textareaClasses =
  "border-border bg-card focus-visible:border-b-primary aria-[invalid=true]:border-destructive aria-[invalid=true]:ring-destructive/20 min-h-[120px] rounded-xl border px-3 py-3 text-base";
// Same chip pattern as /m/onboarding, so the propose form's selectors
// look identical to the onboarding's.
const chipItemClasses =
  "h-10 rounded-full border bg-card text-foreground px-4 text-sm font-medium normal-case tracking-normal hover:bg-card hover:border-primary/40 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

const TAP_STYLE = { touchAction: "manipulation" } as const;

export function ProposeFlow() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<FieldError | null>(null);
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [locateError, setLocateError] = useState<LocateError>(null);
  const [geocoding, setGeocoding] = useState(false);
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
    pin: null,
  });

  // Lock the screen against pull-to-close while the propose flow is
  // open. TgInit calls `disableVerticalSwipes()` once at app boot, but
  // the inline Leaflet map captures touches and re-arms Telegram's
  // swipe-to-dismiss detector on the next vertical gesture — so a user
  // who scrolls past the map then drags down on the form ends up
  // accidentally closing the entire Mini App, losing whatever they've
  // typed. Re-asserting the API on mount of *this* screen is the
  // documented escape hatch (https://core.telegram.org/bots/webapps —
  // "the swipe-to-close gesture is per-WebApp-event, not per-app").
  //
  // Two layers of belt-and-braces:
  //   1. Telegram API   — disables the host-level swipe-to-close
  //      gesture. Only available on Bot API ≥ 7.8; older clients
  //      noop silently.
  //   2. CSS overscroll — `overscroll-behavior: none` on <html> kills
  //      the WKWebView rubber-band that, even with the Telegram API
  //      respected, can still trigger the host's "user is dragging
  //      the WebView" heuristic on iOS. Cheap + works everywhere.
  //
  // Both reverted on unmount so the rest of the app (chat, feed,
  // event detail) keep their default scroll behavior.
  useEffect(() => {
    type WAS = {
      disableVerticalSwipes?: () => void;
      enableVerticalSwipes?: () => void;
      isVersionAtLeast?: (v: string) => boolean;
    };
    const wa = (
      window as unknown as { Telegram?: { WebApp?: WAS } }
    ).Telegram?.WebApp;
    const supportsSwipeApi = wa?.isVersionAtLeast?.("7.8") ?? false;
    if (supportsSwipeApi) {
      try {
        wa?.disableVerticalSwipes?.();
      } catch {
        /* old host — safe to ignore */
      }
    }

    const html = document.documentElement;
    const prevOverscroll = html.style.overscrollBehavior;
    html.style.overscrollBehavior = "none";

    return () => {
      html.style.overscrollBehavior = prevOverscroll;
      if (supportsSwipeApi) {
        try {
          wa?.enableVerticalSwipes?.();
        } catch {
          /* fine */
        }
      }
    };
  }, []);

  // Hold refs to the inputs we may need to focus on validation error.
  // Cheaper and more reliable than `getElementById` (works even if the
  // form is in a portal or has duplicate ids elsewhere on the page).
  const titleRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLInputElement>(null);
  const cityFieldsetRef = useRef<HTMLDivElement>(null);
  const mapWrapperRef = useRef<HTMLDivElement>(null);
  // Track whether the user has typed something into the address input.
  // Empty → we'll auto-fill on the next pin change. Non-empty → leave
  // their text alone, even when they later move the pin. Stored in a
  // ref so the geocode effect doesn't re-run on every keystroke.
  const addressTouchedRef = useRef(false);

  // Pre-fill from the user's profile + Telegram identity:
  //   - city ← /me.city (defaults to ENABLED_CITY otherwise)
  //   - organizerContact ← @<tg_username> so the creator is the
  //     default organizer. Backend doesn't track creator → organizer
  //     in the DB, so this is the closest we can get to "you are
  //     the organizer of what you create" until that link lands.
  //     User can still type over it if delegating to someone else.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [me, tg] = await Promise.all([
          getCurrentUser().catch(() => null),
          getTgUserWithWait(),
        ]);
        if (cancelled) return;
        setForm((f) => {
          let next = f;
          if (me?.city) next = { ...next, city: me.city ?? DEFAULT_CITY };
          if (tg.username && !next.organizerContact.trim()) {
            next = { ...next, organizerContact: `@${tg.username}` };
          }
          return next;
        });
      } catch {
        // ignore — falls back to defaults.
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Reverse-geocode the pin into the address field. Skips when the user
  // has already typed something — their text wins. We deliberately only
  // depend on `form.pin` so typing in the address field doesn't refire
  // the request; `addressTouchedRef` is checked at fire and at response
  // time to handle a user who types while a request is in flight.
  useEffect(() => {
    const pin = form.pin;
    if (!pin) return;
    if (addressTouchedRef.current) return;

    let cancelled = false;
    setGeocoding(true);
    reverseGeocode(pin.lat, pin.lng)
      .then((addr) => {
        if (cancelled || !addr) return;
        setForm((f) => {
          // Stale: user moved the pin again before we got the response.
          if (f.pin !== pin) return f;
          // User typed something during the fetch — don't clobber it.
          if (addressTouchedRef.current) return f;
          return { ...f, address: addr };
        });
      })
      .finally(() => {
        if (!cancelled) setGeocoding(false);
      });

    return () => {
      cancelled = true;
    };
  }, [form.pin]);

  function buildStartAt(): string | null {
    if (!form.date || !form.time) return null;
    // Wall-clock + Europe/Kyiv offset. Backend strips the offset on insert
    // but we send it explicitly so DST is handled correctly.
    return `${form.date}T${form.time}:00+03:00`;
  }

  function validate(): FieldError | null {
    if (!form.title.trim()) return { field: "title", message: "Назва обов'язкова." };
    if (form.title.length > 200)
      return { field: "title", message: "Назва задовга — макс 200 знаків." };
    if (!form.city.trim()) return { field: "city", message: "Обери місто." };
    if (!form.date) return { field: "date", message: "Вибери дату." };
    if (!form.time) return { field: "time", message: "Вибери час." };
    if (!form.pin)
      return {
        field: "pin",
        message: "Постав мітку на мапі — це обов'язково.",
      };
    return null;
  }

  function focusField(field: FieldError["field"]) {
    const el =
      field === "title"
        ? titleRef.current
        : field === "date"
          ? dateRef.current
          : field === "time"
            ? timeRef.current
            : field === "city"
              ? cityFieldsetRef.current
              : field === "pin"
                ? mapWrapperRef.current
                : null;
    if (!el) return;
    // Smooth scroll into view, then focus on the next frame so the
    // keyboard doesn't fight the scroll animation on iOS.
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    requestAnimationFrame(() => {
      try {
        el.focus({ preventScroll: true });
      } catch {
        /* not focusable — that's fine */
      }
    });
  }

  async function onSubmit() {
    const v = validate();
    if (v) {
      setErr(v);
      focusField(v.field);
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const opp = await createOpportunity({
        title: form.title.trim(),
        description: form.description.trim() || null,
        city: form.city.trim(),
        address: form.address.trim() || null,
        location_lat: form.pin!.lat,
        location_lng: form.pin!.lng,
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
      setErr({ field: null, message: describeError(e, "propose") });
    } finally {
      setBusy(false);
    }
  }

  // Clear the inline error for a field as soon as the user starts
  // editing it — rewards the fix immediately without forcing another
  // submit.
  function clearErrorIfMatches(field: keyof FormState) {
    if (err?.field === field) setErr(null);
  }

  function setPin(pin: Pin) {
    setForm((f) => ({ ...f, pin }));
    setLocateError(null);
    clearErrorIfMatches("pin");
  }

  async function detectLocation() {
    if (locating) return;
    setLocating(true);
    setLocateError(null);
    try {
      // Try Telegram's LocationManager first (Bot API 8.0+) — falls
      // through to browser geolocation when not available or denied.
      const tgLoc = await tgGetLocation();
      if (tgLoc) {
        if (!isWithinCityBounds(form.city, tgLoc)) {
          setLocateError("out_of_city");
          return;
        }
        setPin(tgLoc);
        return;
      }
      if (tgLocationDenied()) {
        setLocateError("denied:tg");
        return;
      }
      const browser = await browserGeolocate();
      if (browser === "denied") {
        setLocateError("denied:browser");
        return;
      }
      if (browser === "fail") {
        setLocateError("fail");
        return;
      }
      if (!isWithinCityBounds(form.city, browser)) {
        setLocateError("out_of_city");
        return;
      }
      setPin(browser);
    } finally {
      setLocating(false);
    }
  }

  if (submitted) {
    return (
      <main
        className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-6"
        aria-live="polite"
      >
        <section
          role="status"
          className="bg-card border-border flex flex-col items-center gap-4 rounded-xl border px-5 py-8 text-center"
        >
          <div className="bg-primary/10 flex h-14 w-14 items-center justify-center rounded-full">
            <Sparkles className="text-primary h-6 w-6" aria-hidden />
          </div>
          <div className="space-y-1">
            <h1 className="text-foreground text-xl font-semibold leading-tight">
              Опубліковано
            </h1>
            <p className="text-muted-foreground text-sm">
              Подія вже у стрічці у людей з твого міста.
            </p>
          </div>
        </section>
        <div className="space-y-2">
          <Button
            asChild
            size="lg"
            className="h-12 w-full text-base font-semibold"
            style={TAP_STYLE}
          >
            <Link href={`/m/event/${submitted.id}`}>До події</Link>
          </Button>
          <Button
            asChild
            variant="outline"
            size="lg"
            className="h-12 w-full text-base font-semibold"
            style={TAP_STYLE}
          >
            <Link href="/m/feed">До стрічки</Link>
          </Button>
        </div>
      </main>
    );
  }

  const titleInvalid = err?.field === "title";
  const cityInvalid = err?.field === "city";
  const dateInvalid = err?.field === "date";
  const timeInvalid = err?.field === "time";
  const pinInvalid = err?.field === "pin";

  return (
    // `min-h-0` on both <main> and <form>: nested flex-col items default
    // to `min-height: auto` (= min-content height) which prevents them
    // from shrinking below their content. With content taller than the
    // TMA viewport the form would balloon past its flex slot, push the
    // CTA off-screen, and never engage `overflow-y-auto` — visible on
    // desktop TG as "no wheel scroll." `min-h-0` lets each flex child
    // shrink to its allocated space so the form actually becomes a
    // scroll container.
    <main className="flex min-h-0 flex-1 flex-col">
      <form
        className="min-h-0 flex-1 space-y-6 overflow-y-auto px-4 pb-6 pt-6"
        aria-busy={busy}
        noValidate
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
              ref={titleRef}
              value={form.title}
              onChange={(e) => {
                setForm((f) => ({ ...f, title: e.target.value }));
                clearErrorIfMatches("title");
              }}
              placeholder="наприклад, шахи в суботу"
              maxLength={200}
              autoComplete="off"
              autoCapitalize="sentences"
              enterKeyHint="next"
              aria-required="true"
              aria-invalid={titleInvalid || undefined}
              aria-describedby={titleInvalid ? "title-error" : undefined}
              className={inputClasses}
              required
            />
            {titleInvalid ? (
              <p id="title-error" className="text-destructive text-xs">
                {err?.message}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="description">Опис (необов'язково)</Label>
            <Textarea
              id="description"
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              maxLength={DESCRIPTION_MAX}
              rows={4}
              placeholder="Кілька слів про те, що буде."
              autoCapitalize="sentences"
              className={textareaClasses}
              aria-describedby="description-counter"
            />
            <p
              id="description-counter"
              className="text-muted-foreground text-right text-xs"
            >
              {form.description.length}/{DESCRIPTION_MAX}
            </p>
          </div>
        </Section>

        <Section title="Де">
          <div className="space-y-2" ref={cityFieldsetRef} tabIndex={-1}>
            <Label>Місто</Label>
            <ToggleGroup
              type="single"
              spacing={2}
              value={form.city}
              onValueChange={(v) => {
                if (!v || v !== ENABLED_CITY) return;
                setForm((f) =>
                  f.city === v ? f : { ...f, city: v, pin: null, address: "" },
                );
                // Auto-filled address belonged to the old city; let the
                // next pin trigger a fresh geocode.
                addressTouchedRef.current = false;
                clearErrorIfMatches("city");
                setLocateError(null);
              }}
              className="flex flex-wrap"
              aria-label="Місто"
              aria-describedby="city-hint"
              aria-invalid={cityInvalid || undefined}
            >
              {DEMO_CITIES.map((c) => {
                const enabled = c === ENABLED_CITY;
                return (
                  <ToggleGroupItem
                    key={c}
                    value={c}
                    variant="outline"
                    disabled={!enabled}
                    className={chipItemClasses}
                    style={TAP_STYLE}
                    aria-label={enabled ? c : `${c} — поки що недоступно`}
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
            <p id="city-hint" className="text-muted-foreground text-xs">
              Зараз приймаємо події тільки в Дніпрі.
            </p>
          </div>

          <div ref={mapWrapperRef} tabIndex={-1} className="space-y-1 outline-none">
            <Label>Місце на мапі</Label>
            <MapPicker
              city={form.city}
              pin={form.pin}
              onChange={setPin}
              onLocate={() => void detectLocation()}
              locating={locating}
              invalid={pinInvalid}
            />
            {locateError ? (
              <LocateErrorLine error={locateError} onOpenSettings={tgOpenLocationSettings} />
            ) : null}
            {pinInvalid ? (
              <p className="text-destructive text-xs" role="alert">
                {err?.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-1">
            <Label htmlFor="address">Адреса (необов'язково)</Label>
            <Input
              id="address"
              value={form.address}
              onChange={(e) => {
                const v = e.target.value;
                // Empty text re-enables auto-fill on the next pin change;
                // non-empty marks the field as user-owned.
                addressTouchedRef.current = v.trim().length > 0;
                setForm((f) => ({ ...f, address: v }));
              }}
              placeholder="наприклад, бібліотека ім. Лесі Українки, вул. Грушевського 5"
              maxLength={200}
              autoComplete="street-address"
              autoCapitalize="sentences"
              enterKeyHint="next"
              aria-describedby={geocoding ? "address-geocoding" : undefined}
              className={inputClasses}
            />
            {geocoding ? (
              <p
                id="address-geocoding"
                className="text-muted-foreground text-xs"
                aria-live="polite"
              >
                Визначаємо адресу…
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                Заповнюємо автоматично з мітки на мапі. Можеш уточнити вручну.
              </p>
            )}
          </div>
        </Section>

        <Section title="Коли">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="date">Дата</Label>
              <Input
                id="date"
                ref={dateRef}
                type="date"
                value={form.date}
                onChange={(e) => {
                  setForm((f) => ({ ...f, date: e.target.value }));
                  clearErrorIfMatches("date");
                }}
                className={inputClasses}
                aria-required="true"
                aria-invalid={dateInvalid || undefined}
                aria-describedby={dateInvalid ? "date-error" : undefined}
                required
              />
              {dateInvalid ? (
                <p id="date-error" className="text-destructive text-xs">
                  {err?.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="time">Час</Label>
              <Input
                id="time"
                ref={timeRef}
                type="time"
                value={form.time}
                onChange={(e) => {
                  setForm((f) => ({ ...f, time: e.target.value }));
                  clearErrorIfMatches("time");
                }}
                className={inputClasses}
                aria-required="true"
                aria-invalid={timeInvalid || undefined}
                aria-describedby={timeInvalid ? "time-error" : undefined}
                required
              />
              {timeInvalid ? (
                <p id="time-error" className="text-destructive text-xs">
                  {err?.message}
                </p>
              ) : null}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="duration">Тривалість, хв</Label>
            <Input
              id="duration"
              type="number"
              inputMode="numeric"
              min={15}
              max={600}
              step={15}
              value={form.durationMin}
              onChange={(e) =>
                setForm((f) => ({
                  ...f,
                  durationMin: Number(e.target.value) || DEFAULT_DURATION,
                }))
              }
              className={inputClasses}
            />
          </div>
        </Section>

        <Section title="Деталі">
          <div className="space-y-2">
            <Label htmlFor="price">
              Ціна, ₴{" "}
              <span className="text-muted-foreground font-normal">(0 = безкоштовно)</span>
            </Label>
            <Input
              id="price"
              type="number"
              inputMode="numeric"
              min={0}
              max={100000}
              step={10}
              value={form.priceUah}
              onChange={(e) =>
                setForm((f) => ({ ...f, priceUah: Number(e.target.value) || 0 }))
              }
              className={inputClasses}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organizer">Контакт організатора (необов'язково)</Label>
            <Input
              id="organizer"
              value={form.organizerContact}
              onChange={(e) =>
                setForm((f) => ({ ...f, organizerContact: e.target.value }))
              }
              placeholder="@telegram або +380…"
              autoComplete="off"
              autoCapitalize="none"
              enterKeyHint="done"
              className={inputClasses}
            />
          </div>
        </Section>

        <Section title="Категорії" subtitle="Можна кілька або жодної.">
          <ToggleGroup
            type="multiple"
            spacing={2}
            value={form.interests}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, interests: v as InterestCategory[] }))
            }
            className="flex flex-wrap"
            aria-label="Категорії події"
          >
            {INTEREST_CATEGORIES.map((c) => (
              <ToggleGroupItem
                key={c}
                value={c}
                variant="outline"
                className={chipItemClasses}
                style={TAP_STYLE}
              >
                {INTEREST_LABELS_UK[c]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>

        <Section title="Для кого">
          <ToggleGroup
            type="single"
            spacing={2}
            value={form.identity}
            onValueChange={(v) =>
              v && setForm((f) => ({ ...f, identity: v as IdentityPref }))
            }
            className="flex flex-wrap"
            aria-label="Для кого подія"
          >
            {IDENTITY_PREFS.map((p) => (
              <ToggleGroupItem
                key={p}
                value={p}
                variant="outline"
                className={chipItemClasses}
                style={TAP_STYLE}
              >
                {IDENTITY_LABELS_UK[p]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>

        <Section title="Доступність">
          <ToggleGroup
            type="multiple"
            spacing={2}
            value={form.accessibility}
            onValueChange={(v) =>
              setForm((f) => ({ ...f, accessibility: v as AccessibilityFlag[] }))
            }
            className="flex flex-wrap"
            aria-label="Доступність"
          >
            {ACCESSIBILITY_FLAGS.map((flag) => (
              <ToggleGroupItem
                key={flag}
                value={flag}
                variant="outline"
                className={chipItemClasses}
                style={TAP_STYLE}
              >
                {ACCESSIBILITY_LABELS_UK[flag]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>

        {err && err.field === null ? (
          <div
            role="alert"
            className="bg-destructive/10 text-destructive border-destructive/30 rounded-xl border px-3 py-2 text-sm"
          >
            {err.message}
          </div>
        ) : null}
      </form>

      <div className="bg-background border-border/60 shrink-0 border-t px-4 pb-5 pt-3">
        <Button
          type="button"
          size="lg"
          className="h-12 w-full text-base font-semibold"
          style={TAP_STYLE}
          onClick={() => void onSubmit()}
          disabled={busy}
          aria-disabled={busy || undefined}
        >
          {busy ? "Публікую…" : "Опублікувати"}
        </Button>
      </div>
    </main>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <SectionHeader title={title} subtitle={subtitle} />
      <div className="space-y-3">{children}</div>
    </section>
  );
}

function LocateErrorLine({
  error,
  onOpenSettings,
}: {
  error: NonNullable<LocateError>;
  onOpenSettings: () => void;
}) {
  if (error === "denied:tg") {
    return (
      <p className="text-destructive space-x-1 text-xs" role="alert">
        <span>Telegram заблокував доступ до геолокації.</span>
        <button
          type="button"
          onClick={onOpenSettings}
          className="text-primary inline underline-offset-2 hover:underline"
        >
          Відкрити налаштування
        </button>
      </p>
    );
  }
  if (error === "denied:browser") {
    return (
      <p className="text-destructive text-xs" role="alert">
        Браузер заблокував геолокацію. Постав мітку вручну.
      </p>
    );
  }
  if (error === "out_of_city") {
    return (
      <p className="text-destructive text-xs" role="alert">
        Твоя локація поза межами міста — постав мітку вручну.
      </p>
    );
  }
  return (
    <p className="text-destructive text-xs" role="alert">
      Не вдалось визначити локацію. Постав мітку вручну.
    </p>
  );
}

function browserGeolocate(): Promise<Pin | "denied" | "fail"> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      resolve("fail");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (e) => resolve(e.code === e.PERMISSION_DENIED ? "denied" : "fail"),
      { timeout: 6000, maximumAge: 60_000 },
    );
  });
}
