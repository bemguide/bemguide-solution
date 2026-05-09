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
// detour). Telegram-not-loaded → "Open in Telegram" CTA. The page
// has no top header — the bottom tab bar identifies which screen
// you're on, so a duplicate "Поруч" title up top would just eat
// vertical space.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
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
  // Initial state must match server-render output to avoid hydration
  // mismatches: localStorage isn't available during SSR, so reading
  // the cache here would diverge from the server's null. Cache reads
  // happen in useEffect (after mount) — costs us one extra render
  // when there is a cache, but keeps SSR and the first client paint
  // structurally identical.
  const [sections, setSections] = useState<DisplaySections | null>(null);
  const [city, setCity] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    const startedAt = performance.now();

    const cached = readFeedCache();
    if (cached) {
      setSections(adapt(cached.sections));
      setCity(cached.city ?? undefined);
    }

    async function load() {
      try {
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
        if (!cached) {
          if (isNoTelegramEnv(e)) setError("no_telegram_environment");
          else setError(describeError(e, "feed"));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!sections && error === "no_telegram_environment") {
    return <OpenInTelegramScreen />;
  }

  if (!sections && error) {
    return (
      <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 pt-4">
        <EmptyState
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

  if (!sections) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-4">
        <FeedSkeleton />
      </main>
    );
  }

  const empty =
    sections.today_tomorrow.length === 0 &&
    sections.this_week.length === 0 &&
    sections.try_new.length === 0;

  return (
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 pt-4">
      {empty ? (
        <EmptyState
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

function OpenInTelegramScreen() {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
  const deepLink = botUsername ? `https://t.me/${botUsername}?startapp=feed` : null;
  return (
    <main className="px-6 py-10 text-center">
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
