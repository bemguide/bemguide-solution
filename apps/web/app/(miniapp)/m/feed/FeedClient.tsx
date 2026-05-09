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
  ApiError,
  exchangeInitData,
  getCurrentUser,
  getFeed,
  isSessionExpired,
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
        // If TgInit hasn't finished the exchange yet, do it ourselves.
        if (isSessionExpired()) {
          const initData =
            (typeof window !== "undefined" &&
              (window as { Telegram?: { WebApp?: { initData?: string } } }).Telegram?.WebApp
                ?.initData) ??
            "";
          if (initData) await exchangeInitData(initData);
        }
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
        if (e instanceof ApiError && e.status === 401) {
          setError("Авторизація через Telegram не пройшла. Закрий і відкрий додаток ще раз.");
        } else {
          setError(e instanceof Error ? friendlyError(e) : "Щось пішло не так. Спробуй ще раз.");
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

function friendlyError(e: Error): string {
  if (e instanceof ApiError) {
    if (e.message === "NEXT_PUBLIC_API_BASE is not set") {
      return "Бекенд ще не підключений. Перевір NEXT_PUBLIC_API_BASE.";
    }
    if (e.status === 0) return "Не вдалось дістатися сервера.";
    if (e.status >= 500) return "Сервер тимчасово не відповідає. Спробуй за хвилину.";
  }
  return e.message;
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
