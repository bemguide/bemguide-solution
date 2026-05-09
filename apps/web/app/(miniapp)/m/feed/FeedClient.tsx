// Client-side feed loader. The data fetch must run after Telegram WebApp SDK
// has initialised (so initData is available).

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, ChevronRight, Sparkles } from "lucide-react";
import { fetchWithInitData } from "@/lib/telegram/client";
import { CompactEventCard, FeaturedEventCard } from "@/components/poruch/EventCard";
import { SectionHeader } from "@/components/poruch/SectionHeader";
import { EmptyState } from "@/components/poruch/EmptyState";
import type { EventForDisplay } from "@/lib/types";

type Sections = {
  today_tomorrow: (EventForDisplay & { ai_reason?: string })[];
  this_week: (EventForDisplay & { ai_reason?: string })[];
  try_new: (EventForDisplay & { ai_reason?: string })[];
};

type FeedResp = {
  ok: boolean;
  city?: string;
  sections?: Sections;
  error?: string;
};

export function FeedClient() {
  const [loading, setLoading] = useState(true);
  const [city, setCity] = useState<string | undefined>();
  const [sections, setSections] = useState<Sections | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { status, json } = await fetchWithInitData<FeedResp>("/api/feed", {
        method: "GET",
      });
      if (cancelled) return;
      if (status === 401) {
        setError("Авторизація через Telegram не пройшла. Закрий і відкрий додаток ще раз.");
        setLoading(false);
        return;
      }
      if (!json?.ok || !json.sections) {
        setError(json?.error ?? "Щось пішло не так. Спробуй ще раз.");
        setLoading(false);
        return;
      }
      setCity(json.city);
      setSections(json.sections);
      setLoading(false);
    }
    load();
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
    <main className="flex flex-1 flex-col gap-6 px-4 pb-24 pt-4">
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
            {sections.today_tomorrow.map((e) => (
              <FeaturedEventCard key={e.id} event={e} surface="miniapp" />
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
