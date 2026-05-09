// /m/feed — miniapp home. Stale-while-revalidate against the v2
// backend so the page paints instantly on return visits and never
// leaves the user staring at a full-page skeleton:
//
//   1. On mount, read the localStorage cache and seed state from it.
//      First paint is the previous successful feed (or the empty
//      state / skeleton if no cache).
//   2. Fire `getCurrentUser()` and `getFeed()` in parallel (the
//      backend defaults to the user's stored city when ?city is
//      omitted, so /feed doesn't need to wait on /me).
//   3. When fresh data arrives, swap state and write the cache. On
//      failure, keep the stale data — only swap to an error UI when
//      we have nothing at all.
//
// Empty backend → instant empty-state once data arrives (no spinner
// detour). Telegram-not-loaded → "Open in Telegram" CTA.

"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, RefreshCw, Sparkles } from "lucide-react";
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
  readFeedCache,
  writeFeedCache,
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
  // Hydrate from cache so first paint already has content (when
  // anything is cached) — typical return-visit case.
  const cached = useMemo(() => readFeedCache(), []);

  const [sections, setSections] = useState<DisplaySections | null>(
    cached ? adapt(cached.sections) : null,
  );
  const [city, setCity] = useState<string | undefined>(cached?.city);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    const startedAt = performance.now();

    async function load() {
      try {
        // Parallel: /feed defaults to the user's stored city when no
        // ?city is passed, so it doesn't need /me to resolve first.
        const [me, v2] = await Promise.all([
          getCurrentUser().catch(() => null),
          getFeed(),
        ]);
        if (cancelled) return;

        const myCity = me?.city ?? cached?.city;
        const fresh = adapt(v2);
        setCity(myCity ?? undefined);
        setSections(fresh);
        setError(null);
        writeFeedCache({ sections: v2, city: myCity ?? undefined });

        if (process.env.NODE_ENV !== "production") {
          const total =
            v2.today_tomorrow.length + v2.this_week.length + v2.try_new.length;
          const ms = Math.round(performance.now() - startedAt);
          console.debug(
            `[feed] backend returned ${total} items in ${ms}ms (city=${myCity ?? "—"})`,
          );
        }
      } catch (e) {
        if (cancelled) return;
        logApiError("feed", e);
        // Only surface an error if we have *nothing* to show. With
        // cached data we keep the stale view and stay quiet.
        if (!sections) {
          if (isNoTelegramEnv(e)) setError("no_telegram_environment");
          else setError(describeError(e, "feed"));
        }
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The "Open in Telegram" CTA is its own dedicated screen — don't
  // bury it under a generic error.
  if (!sections && error === "no_telegram_environment") {
    return <OpenInTelegramScreen />;
  }

  // Hard fail: no cache *and* fetch failed → show the inline error
  // with a retry link. (The caller can always pull-to-refresh by
  // re-opening the Mini App.)
  if (!sections && error) {
    return (
      <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-24 pt-4">
        <FeedHeader city={city} refreshing={false} />
        <EmptyState
          icon={<Sparkles className="h-10 w-10" aria-hidden />}
          title="Не вдалось завантажити стрічку"
          body={error}
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

  // Initial cold load with no cache yet — show a tight skeleton so
  // there's something on screen within one frame.
  if (!sections) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-24 pt-4">
        <FeedHeader city={city} refreshing />
        <FeedSkeleton />
      </main>
    );
  }

  const empty =
    sections.today_tomorrow.length === 0 &&
    sections.this_week.length === 0 &&
    sections.try_new.length === 0;

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-24 pt-4">
      <FeedHeader city={city} refreshing={refreshing} />

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

function FeedHeader({
  city,
  refreshing,
}: {
  city?: string;
  refreshing: boolean;
}) {
  return (
    <header className="flex items-center justify-between">
      <h1 className="text-foreground inline-flex items-center gap-2 text-xl font-semibold">
        Поруч{city ? ` · ${city}` : ""}
        {refreshing ? (
          <RefreshCw className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden />
        ) : null}
      </h1>
      <Link
        href="/m/me"
        className="bg-secondary text-secondary-foreground inline-flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold"
        aria-label="Профіль"
      >
        {city?.[0] ?? "Я"}
      </Link>
    </header>
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
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <div className="bg-muted aspect-[16/9] w-full animate-pulse rounded-xl" />
          <div className="bg-muted h-4 w-3/4 animate-pulse rounded" />
          <div className="bg-muted h-3 w-1/2 animate-pulse rounded" />
        </div>
      ))}
    </div>
  );
}
