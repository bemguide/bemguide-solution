// /m/feed — miniapp home. Four tabs across the same `/feed` endpoint:
//
//   "Все"      → `getFeed()`                          → today_tomorrow / this_week / try_new
//   "Здоровʼя" → `getFeed({ filter: 'health' })`      → flat list, mixed sources
//   "Знижки"   → `getFeed({ filter: 'discounts' })`   → flat list, mixed sources
//   "Програми" → `getProgramsFeed()`                  → state programs grouped by category + hotlines
//
// Filtered tabs (health/discounts) return `FeedItem`s that can be either
// `opportunity` (event card with RSVP + start_at) or `opportunity_health`
// (always-on place card). Programs return their own shape — see
// docs/PROGRAMS_FEED_CONTRACT.md.
//
// Default tab keeps the localStorage stale-while-revalidate dance from
// before. Filtered tabs and the programs tab fetch fresh on switch —
// they're lighter and less worth caching.

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CompactEventCard, FeaturedEventCard } from "@/components/poruch/EventCard";
import { PlaceCard } from "@/components/poruch/PlaceCard";
import { ProgramCard } from "@/components/poruch/ProgramCard";
import { HotlinesBlock } from "@/components/poruch/HotlinesBlock";
import { SectionHeader } from "@/components/poruch/SectionHeader";
import { EmptyState } from "@/components/poruch/EmptyState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  describeError,
  getCurrentUser,
  getFeed,
  getProgramsFeed,
  isNoTelegramEnv,
  logApiError,
  opportunityToDisplay,
  readFeedCache,
  writeFeedCache,
  type FeedItem,
  type FeedResponse,
  type ProgramCategory,
  type ProgramFeedItem,
  type ProgramsFeedResponse,
  type V2User,
} from "@/lib/api";
import { loadHealthPrefs } from "@/lib/app-prefs";
import { listBookmarks } from "@/lib/bookmarks";
import type { EventForDisplay } from "@/lib/types";

type Tab = "all" | "health" | "discounts" | "programs";

const TAB_PREF_KEY = "poruch.feed.last_tab.v1";
const VALID_TABS: ReadonlySet<Tab> = new Set(["all", "health", "discounts", "programs"]);

/**
 * Pick the initial tab on a fresh mount per spec v2 §6.2:
 *   - If the user previously picked a tab here, restore it.
 *   - Otherwise, if onboarding flagged `health_assistance_needed`,
 *     drop them on «Здоровʼя» so the screen they land on is already
 *     useful.
 *   - Otherwise default to «Все».
 *
 * Reading localStorage at init time is safe: this component is "use
 * client", so the call only fires after hydration.
 */
function pickInitialTab(): Tab {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(TAB_PREF_KEY);
    if (stored && VALID_TABS.has(stored as Tab)) return stored as Tab;
  } catch {
    /* localStorage blocked — fall through */
  }
  const health = loadHealthPrefs();
  if (health.needed === true) return "health";
  return "all";
}

function persistTabChoice(tab: Tab): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(TAB_PREF_KEY, tab);
  } catch {
    /* non-fatal */
  }
}

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
  programs: "Програми",
};

// Stable category order from the contract. Categories absent from the
// response don't render — but when present we always show them in this
// sequence so the user's mental model is "health first, support last".
const PROGRAM_CATEGORY_ORDER: ProgramCategory[] = [
  "health",
  "money",
  "housing",
  "education_work",
  "sport_recreation",
  "support",
];

const PROGRAM_CATEGORY_HEADING: Record<ProgramCategory, string> = {
  health: "🩺 Здоров'я",
  money: "💰 Гроші",
  housing: "🏠 Житло",
  education_work: "🎓 Освіта і робота",
  sport_recreation: "🏋️ Спорт і відпочинок",
  support: "🤝 Підтримка",
};

const chipItemClasses =
  "h-9 rounded-full border bg-card text-foreground px-4 text-sm font-medium normal-case tracking-normal hover:bg-card hover:border-primary/40 data-[state=on]:border-primary data-[state=on]:bg-primary data-[state=on]:text-primary-foreground";

export function FeedClient() {
  // Lazy initialiser so the localStorage read happens once at mount
  // and never re-runs on parent re-renders.
  const [tab, setTabState] = useState<Tab>(pickInitialTab);
  const setTab = (next: Tab) => {
    setTabState(next);
    persistTabChoice(next);
  };

  // Default-tab state (cached, sticky across remounts).
  const [sections, setSections] = useState<DisplaySections | null>(null);
  const [city, setCity] = useState<string | undefined>(undefined);
  const [defaultError, setDefaultError] = useState<string | null>(null);
  // We keep a copy of the user so the programs tab can show the
  // "обери статус" soft prompt when veteran_status is null.
  const [me, setMe] = useState<V2User | null>(null);

  // Filtered-tab state (per filter; refetched on switch).
  const [filtered, setFiltered] = useState<FeedItem[] | null>(null);
  const [filteredLoading, setFilteredLoading] = useState(false);
  const [filteredError, setFilteredError] = useState<string | null>(null);

  // Programs-tab state — distinct shape from filtered (items + hotlines).
  const [programs, setPrograms] = useState<ProgramsFeedResponse | null>(null);
  const [programsLoading, setProgramsLoading] = useState(false);
  const [programsError, setProgramsError] = useState<string | null>(null);

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
        const [meRes, v2] = await Promise.all([
          getCurrentUser().catch(() => null),
          getFeed(),
        ]);
        if (cancelled) return;

        const myCity = meRes?.city ?? cached?.city;
        setMe(meRes);
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

  // Filtered tabs (health / discounts) — refetch when the user
  // switches to one.
  useEffect(() => {
    if (tab !== "health" && tab !== "discounts") return;
    // Capture in a const so the type narrowing survives across the
    // async IIFE boundary — TS widens `tab` back to the full Tab
    // union inside the inner closure otherwise.
    const filter = tab;
    let cancelled = false;
    setFilteredLoading(true);
    setFilteredError(null);
    void (async () => {
      try {
        const res = await getFeed({ filter });
        if (cancelled) return;
        setFiltered(res.items);

        if (process.env.NODE_ENV !== "production") {
          console.debug(`[feed] filter=${filter} returned ${res.items.length} items`);
        }
      } catch (e) {
        if (cancelled) return;
        logApiError(`feed.${filter}`, e);
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

  // Programs tab — distinct response shape (`items + hotlines`).
  useEffect(() => {
    if (tab !== "programs") return;
    let cancelled = false;
    setProgramsLoading(true);
    setProgramsError(null);
    void (async () => {
      try {
        const res = await getProgramsFeed();
        if (cancelled) return;
        setPrograms(res);
        if (process.env.NODE_ENV !== "production") {
          console.debug(
            `[feed] programs returned items=${res.items.length} hotlines=${res.hotlines.length}`,
          );
        }
      } catch (e) {
        if (cancelled) return;
        logApiError("feed.programs", e);
        if (isNoTelegramEnv(e)) setProgramsError("no_telegram_environment");
        else setProgramsError(describeError(e, "feed"));
      } finally {
        if (!cancelled) setProgramsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tab]);

  // The "Open in Telegram" CTA preempts everything else.
  const noTg =
    defaultError === "no_telegram_environment" ||
    filteredError === "no_telegram_environment" ||
    programsError === "no_telegram_environment";
  if (noTg && !sections && !filtered && !programs) {
    return <OpenInTelegramScreen />;
  }

  // Soft profile-completion nudge for users who landed on the feed
  // without finishing onboarding. Root no longer force-redirects new
  // users into onboarding (the feed is the default surface), so this
  // banner is the only way they discover the questionnaire — keep it
  // visible whenever `me.city` is null and they're on the default
  // tab. Filtered tabs are scoped enough that the prompt would feel
  // off-topic.
  const showOnboardingNudge = me !== null && me.city === null && tab === "all";

  return (
    <main className="relative flex flex-1 flex-col overflow-y-auto pb-6">
      {/* Sticky chip strip — keeps the filter row reachable even
          deep inside a long feed. The bg + small bottom border gives
          it a clear edge against the cards scrolling underneath, so
          it stays readable without feeling like a separate UI region. */}
      <div className="bg-background border-border/40 sticky top-0 z-10 border-b px-4 pb-3 pt-4 backdrop-blur">
        <FilterTabs tab={tab} onChange={setTab} />
      </div>

      <div className="flex flex-col gap-4 px-4 pt-4">
        {showOnboardingNudge ? <OnboardingNudge /> : null}

        {tab === "all" ? (
        <DefaultBody
          sections={sections}
          city={city}
          error={defaultError === "no_telegram_environment" ? null : defaultError}
        />
      ) : tab === "programs" ? (
        <ProgramsBody
          data={programs}
          loading={programsLoading}
          error={programsError === "no_telegram_environment" ? null : programsError}
          veteranStatusKnown={Boolean(me?.veteran_status)}
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
      </div>
    </main>
  );
}

function OnboardingNudge() {
  // One-line invitation, not a wall of copy. Aim is to make the
  // user *aware* that personalisation exists without blocking them
  // from browsing the feed. The `Link` covers the whole strip so
  // anywhere they tap leads into onboarding.
  return (
    <Link
      href="/m/onboarding"
      className="bg-accent/40 border-border text-foreground hover:border-primary/40 hover:bg-accent/60 -mt-1 block rounded-xl border px-4 py-3 text-sm transition-[transform,background-color,border-color] duration-150 ease-out active:scale-[0.985]"
      style={{ touchAction: "manipulation" }}
    >
      <strong className="text-foreground font-semibold">Налаштувати профіль</strong>{" "}
      <span className="text-muted-foreground">
        — щоб стрічка показувала те, що тобі важливо. Кілька питань.
      </span>
    </Link>
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
  tab: "health" | "discounts";
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

// Sub-filter inside the Програми tab. "all" shows the full grouped
// list (the original behaviour); a category shows just that section
// flat, no heading; "saved" pulls every program the user bookmarked
// across categories. Persisted to localStorage so a returning user
// lands on whatever they were looking at last time.
type ProgramFilter = ProgramCategory | "all" | "saved";

const PROGRAM_FILTER_PREF_KEY = "poruch.programs.last_filter.v1";
const PROGRAM_FILTER_LABEL: Record<ProgramFilter, string> = {
  all: "Все",
  health: "Здоров'я",
  money: "Гроші",
  housing: "Житло",
  education_work: "Освіта і робота",
  sport_recreation: "Спорт",
  support: "Підтримка",
  saved: "Збережені",
};

const PROGRAM_FILTER_ORDER: ProgramFilter[] = [
  "all",
  "saved",
  ...PROGRAM_CATEGORY_ORDER,
];

function loadProgramFilter(): ProgramFilter {
  if (typeof window === "undefined") return "all";
  try {
    const stored = window.localStorage.getItem(PROGRAM_FILTER_PREF_KEY);
    if (stored && stored in PROGRAM_FILTER_LABEL) return stored as ProgramFilter;
  } catch {
    /* private mode etc. */
  }
  return "all";
}

function saveProgramFilter(filter: ProgramFilter): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PROGRAM_FILTER_PREF_KEY, filter);
  } catch {
    /* non-fatal */
  }
}

function ProgramsBody({
  data,
  loading,
  error,
  veteranStatusKnown,
}: {
  data: ProgramsFeedResponse | null;
  loading: boolean;
  error: string | null;
  /**
   * Drives the soft "обери статус" prompt at the top of the body.
   * The contract returns *every* program when veteran_status is null,
   * so this is purely a UX nudge — never a gate.
   */
  veteranStatusKnown: boolean;
}) {
  // Lazy initialiser keeps the localStorage read off the server-side
  // render and out of every parent re-render after mount.
  const [filter, setFilterState] = useState<ProgramFilter>(loadProgramFilter);
  const setFilter = (next: ProgramFilter) => {
    setFilterState(next);
    saveProgramFilter(next);
  };

  // Saved-IDs snapshot. Refreshed on filter switch so toggling a
  // bookmark on a card and then opening "Збережені" reflects reality
  // even though localStorage isn't reactive on its own.
  const [savedIds, setSavedIds] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    if (filter === "saved") setSavedIds(new Set(listBookmarks("program")));
  }, [filter]);

  if (loading && !data) return <FeedSkeleton />;

  if (error && !data) {
    return (
      <EmptyState
        title="Не вдалось завантажити програми"
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

  if (!data) return <FeedSkeleton />;

  // Apply the sub-filter. We always render the chips so the user
  // can switch back to "Все" from an empty filtered state.
  let visibleItems: ProgramFeedItem[];
  if (filter === "all") {
    visibleItems = data.items;
  } else if (filter === "saved") {
    visibleItems = data.items.filter((p) => savedIds.has(p.id));
  } else {
    visibleItems = data.items.filter((p) => p.program_category === filter);
  }
  const grouped = groupByCategory(visibleItems);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="Безкоштовні державні програми"
        subtitle="Що вже доступне ветеранам — без черг, з лінком на офіційне джерело."
      />

      <ProgramFilterChips active={filter} onChange={setFilter} />

      {!veteranStatusKnown ? (
        <Link
          href="/m/onboarding"
          className="bg-accent/40 border-border text-foreground hover:border-primary/40 block rounded-xl border px-4 py-3 text-sm transition-colors"
        >
          <strong className="font-semibold">Обери свій статус</strong>{" "}
          <span className="text-muted-foreground">
            у профілі — покажемо лише ті програми, що тобі реально доступні.
          </span>
        </Link>
      ) : null}

      {visibleItems.length === 0 ? (
        <EmptyState
          title={
            filter === "saved"
              ? "Тут поки що порожньо"
              : "Поки що нічого не підходить"
          }
          body={
            filter === "saved"
              ? "Збережи програму на картці — вона з'явиться тут."
              : "Спробуй іншу категорію або глянь гарячі лінії нижче."
          }
        />
      ) : filter === "all" ? (
        // The grouped view stays for "all" so users see the
        // category structure and can browse top-down. Filtered views
        // collapse to a flat list — the chip already names the
        // category, so a heading would just repeat it.
        PROGRAM_CATEGORY_ORDER.filter(
          (c) => (grouped.get(c)?.length ?? 0) > 0,
        ).map((category) => (
          <section key={category} className="space-y-3">
            <h2 className="text-foreground text-base font-semibold">
              {PROGRAM_CATEGORY_HEADING[category]}
            </h2>
            <div className="space-y-3">
              {(grouped.get(category) ?? []).map((p) => (
                <ProgramCard key={p.id} program={p} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="space-y-3">
          {visibleItems.map((p) => (
            <ProgramCard key={p.id} program={p} />
          ))}
        </div>
      )}

      <HotlinesBlock hotlines={data.hotlines} />
    </div>
  );
}

function ProgramFilterChips({
  active,
  onChange,
}: {
  active: ProgramFilter;
  onChange: (next: ProgramFilter) => void;
}) {
  // 8 chips wrap to two rows on narrow screens — that double-line
  // strip ate vertical space and broke the visual rhythm with the
  // tabs above. Single horizontal scroll row keeps the chip strip
  // one line tall and lets users flick through categories the same
  // way they'd flick through stories. The negative -mx pulls the
  // scroll edge under the section's px-4 so the first/last chip can
  // brush the screen edge — same trick used for the tab strip.
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToggleGroup
        type="single"
        spacing={2}
        value={active}
        onValueChange={(v) => v && onChange(v as ProgramFilter)}
        className="flex w-max flex-nowrap"
        aria-label="Фільтр програм"
      >
        {PROGRAM_FILTER_ORDER.map((f) => (
          <ToggleGroupItem
            key={f}
            value={f}
            variant="outline"
            className={chipItemClasses}
            aria-label={PROGRAM_FILTER_LABEL[f]}
          >
            {PROGRAM_FILTER_LABEL[f]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

function groupByCategory(
  items: ProgramFeedItem[],
): Map<ProgramCategory, ProgramFeedItem[]> {
  const out = new Map<ProgramCategory, ProgramFeedItem[]>();
  for (const item of items) {
    const list = out.get(item.program_category);
    if (list) list.push(item);
    else out.set(item.program_category, [item]);
  }
  return out;
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
