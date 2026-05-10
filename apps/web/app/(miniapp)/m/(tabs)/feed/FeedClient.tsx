// /m/feed — miniapp home. Three tabs across the same `/feed` endpoint:
//
//   "Все"     → `getFeed()`              → today_tomorrow / this_week / try_new
//   "Здоровʼя" → `getFeed({ filter: 'health' })`     → flat list, mixed sources
//   "Знижки"  → `getFeed({ filter: 'discounts' })`   → flat list, mixed sources
//
// Filtered tabs return `FeedItem`s that can be either `opportunity`
// (event card with RSVP + start_at) or `opportunity_health` (always-on
// place card with map link + visit_count). The `source` discriminator
// picks which card renders.
//
// Default tab keeps the localStorage stale-while-revalidate dance from
// before. Filtered tabs fetch fresh on switch — they're lighter and
// less worth caching.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CompactEventCard, FeaturedEventCard } from "@/components/poruch/EventCard";
import { PlaceCard } from "@/components/poruch/PlaceCard";
import { SectionHeader } from "@/components/poruch/SectionHeader";
import { EmptyState } from "@/components/poruch/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  describeError,
  getCurrentUser,
  getFeed,
  isNoTelegramEnv,
  logApiError,
  opportunityToDisplay,
  readFeedCache,
  writeFeedCache,
  type FeedItem,
  type FeedResponse,
} from "@/lib/api";
import type { EventForDisplay } from "@/lib/types";

type Tab = "all" | "health" | "discounts";

type DisplaySections = {
  today_tomorrow: EventForDisplay[];
  this_week: EventForDisplay[];
  try_new: EventForDisplay[];
};

function adapt(sections: FeedResponse): DisplaySections {
  return {
    today_tomorrow: sections.today_tomorrow.map(opportunityToDisplay),
    this_week: sections.this_week.map(opportunityToDisplay),
    try_new: sections.try_new.map(opportunityToDisplay),
  };
}

const TAB_LABEL: Record<Tab, string> = {
  all: "Все",
  health: "Здоровʼя",
  discounts: "Знижки",
};

const chipItemClasses =
  "h-9 rounded-full border bg-card text-foreground px-4 text-sm font-medium normal-case tracking-normal hover:bg-card hover:border-primary/40 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

export function FeedClient() {
  const [tab, setTab] = useState<Tab>("all");

  // Default-tab state (cached, sticky across remounts).
  const [sections, setSections] = useState<DisplaySections | null>(null);
  const [city, setCity] = useState<string | undefined>(undefined);
  const [defaultError, setDefaultError] = useState<string | null>(null);

  // Filtered-tab state (per filter; refetched on switch).
  const [filtered, setFiltered] = useState<FeedItem[] | null>(null);
  const [filteredLoading, setFilteredLoading] = useState(false);
  const [filteredError, setFilteredError] = useState<string | null>(null);

  // Default tab — runs once on mount, mirrors the previous behaviour.
  useEffect(() => {
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
        setCity(myCity ?? undefined);
        setSections(adapt(v2));
        setDefaultError(null);
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
          if (isNoTelegramEnv(e)) setDefaultError("no_telegram_environment");
          else setDefaultError(describeError(e, "feed"));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Filtered tabs — refetch when the user switches to one.
  useEffect(() => {
    if (tab === "all") return;
    let cancelled = false;
    setFilteredLoading(true);
    setFilteredError(null);
    void (async () => {
      try {
        const res = await getFeed({ filter: tab });
        if (cancelled) return;
        setFiltered(res.items);

        if (process.env.NODE_ENV !== "production") {
          console.debug(`[feed] filter=${tab} returned ${res.items.length} items`);
        }
      } catch (e) {
        if (cancelled) return;
        logApiError(`feed.${tab}`, e);
        if (isNoTelegramEnv(e)) setFilteredError("no_telegram_environment");
        else setFilteredError(describeError(e, "feed"));
      } finally {
        if (!cancelled) setFilteredLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  // The "Open in Telegram" CTA preempts everything else.
  const noTg =
    defaultError === "no_telegram_environment" ||
    filteredError === "no_telegram_environment";
  if (noTg && !sections && !filtered) {
    return <OpenInTelegramScreen />;
  }

  return (
    <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-6 pt-4">
      <FilterTabs tab={tab} onChange={setTab} />

      {tab === "all" ? (
        <DefaultBody
          sections={sections}
          city={city}
          error={defaultError === "no_telegram_environment" ? null : defaultError}
        />
      ) : (
        <FilteredBody
          tab={tab}
          items={filtered}
          loading={filteredLoading}
          error={
            filteredError === "no_telegram_environment" ? null : filteredError
          }
          city={city}
        />
      )}
    </main>
  );
}

function FilterTabs({ tab, onChange }: { tab: Tab; onChange: (t: Tab) => void }) {
  return (
    <ToggleGroup
      type="single"
      spacing={2}
      value={tab}
      onValueChange={(v) => v && onChange(v as Tab)}
      className="flex flex-wrap"
    >
      {(Object.keys(TAB_LABEL) as Tab[]).map((t) => (
        <ToggleGroupItem
          key={t}
          value={t}
          variant="outline"
          className={chipItemClasses}
          aria-label={TAB_LABEL[t]}
        >
          {TAB_LABEL[t]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

function DefaultBody({
  sections,
  city,
  error,
}: {
  sections: DisplaySections | null;
  city: string | undefined;
  error: string | null;
}) {
  if (!sections && error) {
    return (
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
    );
  }

  if (!sections) return <FeedSkeleton />;

  const empty =
    sections.today_tomorrow.length === 0 &&
    sections.this_week.length === 0 &&
    sections.try_new.length === 0;

  if (empty) {
    return (
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
    );
  }

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}

function FilteredBody({
  tab,
  items,
  loading,
  error,
  city,
}: {
  tab: Tab;
  items: FeedItem[] | null;
  loading: boolean;
  error: string | null;
  city: string | undefined;
}) {
  if (loading && !items) return <FeedSkeleton />;

  if (error && !items) {
    return (
      <EmptyState
        title="Не вдалось завантажити"
        body={error}
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="text-primary text-sm underline-offset-2 hover:underline"
          >
            Спробувати ще
          </button>
        }
      />
    );
  }

  if (!items || items.length === 0) {
    const tip =
      tab === "health"
        ? `У ${city ?? "твоєму місті"} зараз немає ресурсів зі здоровʼя. Спробуй іншу вкладку.`
        : `У ${city ?? "твоєму місті"} зараз немає актуальних знижок. Спробуй пізніше.`;
    return <EmptyState title="Поки що порожньо" body={tip} />;
  }

  return (
    <div className="space-y-3">
      {items.map((item) =>
        item.source === "opportunity" ? (
          <FeaturedEventCard
            key={`opp-${item.id}`}
            event={opportunityToDisplay(item)}
            surface="miniapp"
          />
        ) : (
          <PlaceCard key={`place-${item.id}`} place={item} />
        ),
      )}
    </div>
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
