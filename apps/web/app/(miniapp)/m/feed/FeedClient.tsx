// Client-side feed loader. Talks to the v2 backend via @/lib/api.
// `getFeed` requires the session token that TgInit has already exchanged
// (or will be in the process of exchanging — we retry once on 401).

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, Sparkles } from "lucide-react";
import { CompactEventCard, FeaturedEventCard } from "@/components/poruch/EventCard";
import { SectionHeader } from "@/components/poruch/SectionHeader";
import { EmptyState } from "@/components/poruch/EmptyState";
import {
  describeError,
  getCurrentUser,
  getFeed,
  isNoTelegramEnv,
  logApiError,
  opportunityToDisplay,
  type FeedSections as V2FeedSections,
} from "@/lib/api";
import type { EventForDisplay } from "@/lib/types";

type DisplaySections = {
  today_tomorrow: EventForDisplay[];
  this_week: EventForDisplay[];
  try_new: EventForDisplay[];
};

function adapt(sections: V2FeedSections): DisplaySections {
  return {
    today_tomorrow: sections.today_tomorrow.map(opportunityToDisplay),
    this_week: sections.this_week.map(opportunityToDisplay),
    try_new: sections.try_new.map(opportunityToDisplay),
  };
}

export function FeedClient() {
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<string | undefined>();
  const [sections, setSections] = useState<DisplaySections | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Avoid double-fetch in React strict mode (dev) and StrictMode unmount/remount.
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    async function load() {
      try {
        // apiFetch auto-exchanges initData when the token is missing,
        // self-heals a single 401, and back-offs after auth failure.
        const me = await getCurrentUser().catch(() => null);
        if (cancelled) return;
        const myCity = me?.city ?? undefined;
        const v2 = await getFeed({ city: myCity });
        if (cancelled) return;
        setCity(myCity);
        setSections(adapt(v2));
        setLoading(false);
      } catch (e) {
        if (cancelled) return;
        logApiError("feed", e);
        if (isNoTelegramEnv(e)) {
          setError("no_telegram_environment");
        } else {
          setError(describeError(e, "feed"));
        }
        setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <FeedSkeleton />;
  }

  if (error || !sections) {
    // The "open in Telegram" path has its own dedicated UI so we don't
    // bury it under a generic error.
    if (error === "no_telegram_environment") {
      return <OpenInTelegramScreen />;
    }
    return (
      <main className="px-4 py-6">
        <EmptyState
          icon={<Sparkles className="h-10 w-10" aria-hidden />}
          title="Не вдалось завантажити стрічку"
          body={error ?? undefined}
          action={
            <Link
              href="/m/feed"
              className="text-primary text-sm underline-offset-2 hover:underline"
            >
              Спробувати ще
            </Link>
          }
        />
      </main>
    );
  }

  const empty =
    sections.today_tomorrow.length === 0 &&
    sections.this_week.length === 0 &&
    sections.try_new.length === 0;

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-24 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-foreground text-xl font-semibold">Поруч{city ? ` · ${city}` : ""}</h1>
        <Link
          href="/m/me"
          className="bg-secondary text-secondary-foreground inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
          aria-label="Профіль"
        >
          {city?.[0] ?? "Я"}
        </Link>
      </header>

      {empty ? (
        <EmptyState
          icon={<Sparkles className="h-10 w-10" aria-hidden />}
          title="Поки що небагато подій"
          body={`У ${city ?? "твоєму місті"} зараз небагато подій. Подивись на мапі або запропонуй свою.`}
          action={
            <Link
              href="/m/propose"
              className="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-semibold"
            >
              Запропонувати
            </Link>
          }
        />
      ) : null}

      {sections.today_tomorrow.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader title="Сьогодні і завтра поруч" />
          <div className="space-y-3">
            {sections.today_tomorrow.map((e, i) => (
              <FeaturedEventCard key={e.id} event={e} surface="miniapp" priority={i === 0} />
            ))}
          </div>
        </section>
      ) : null}

      {sections.this_week.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader title={`Цього тижня у ${city ?? ""}`} />
          <div className="space-y-2">
            {sections.this_week.map((e) => (
              <CompactEventCard key={e.id} event={e} surface="miniapp" />
            ))}
          </div>
        </section>
      ) : null}

      {sections.try_new.length > 0 ? (
        <section className="space-y-3">
          <SectionHeader
            title="Спробуй щось нове"
            subtitle="Поза твоїми звичайними інтересами, але з реальними людьми"
          />
          <div className="space-y-3">
            {sections.try_new.map((e) => (
              <FeaturedEventCard key={e.id} event={e} surface="miniapp" />
            ))}
          </div>
        </section>
      ) : null}

      <Link
        href="/m/map"
        className="text-foreground inline-flex items-center gap-1 text-sm underline-offset-2 hover:underline"
      >
        Більше — на мапі
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>

      <Link
        href="/m/propose"
        aria-label="Запропонувати подію"
        className="bg-primary text-primary-foreground fixed bottom-6 right-4 z-30 flex h-14 items-center gap-2 rounded-full px-5 text-sm font-semibold shadow-lg"
      >
        <Plus className="h-5 w-5" aria-hidden />
        Запропонувати
      </Link>
    </main>
  );
}

function OpenInTelegramScreen() {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
  const deepLink = botUsername ? `https://t.me/${botUsername}?startapp=feed` : null;
  return (
    <main className="px-6 py-10 text-center">
      <div className="bg-primary/10 mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full">
        <Sparkles className="text-primary h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-foreground text-xl font-semibold">Відкрий у Telegram</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        Цей екран працює всередині додатка Telegram — там ми бачимо твій профіль і показуємо події
        поряд.
      </p>
      {deepLink ? (
        <Link
          href={deepLink}
          className="bg-primary text-primary-foreground mt-6 inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold"
        >
          Відкрити у Telegram
        </Link>
      ) : null}
    </main>
  );
}

function FeedSkeleton() {
  return (
    <main className="flex flex-1 flex-col gap-4 px-4 pt-4">
      <div className="bg-muted h-6 w-32 animate-pulse rounded" />
      <div className="space-y-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <div className="bg-muted aspect-[16/9] w-full animate-pulse rounded-xl" />
            <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
            <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
          </div>
        ))}
      </div>
    </main>
  );
}
