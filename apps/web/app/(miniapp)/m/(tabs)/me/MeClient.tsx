// Profile tab. Pulls /me + /me/upcoming in parallel and shows:
//
//   - Display name (or "Анонімно") + privacy mode + city
//   - Upcoming attendances (joining / attended)
//   - Re-onboard link + sign-out
//
// Same stale-while-revalidate pattern as /m/feed: paint instantly
// from any cached /me, refresh in background, swap when fresh.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CalendarClock, ChevronRight, MapPin, Pencil, RefreshCw, User } from "lucide-react";
import {
  describeError,
  getCurrentUser,
  getUpcoming,
  isNoTelegramEnv,
  logApiError,
  logout,
  type UpcomingItem,
  type V2User,
} from "@/lib/api";
import { formatEventDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/poruch/EmptyState";
import { SectionHeader } from "@/components/poruch/SectionHeader";

export function MeClient() {
  const [me, setMe] = useState<V2User | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[] | null>(null);
  const [refreshing, setRefreshing] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;
    async function load() {
      try {
        const [meRes, upRes] = await Promise.all([
          getCurrentUser(),
          getUpcoming().catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setMe(meRes);
        setUpcoming(upRes.items);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        logApiError("me", e);
        if (isNoTelegramEnv(e)) setError("no_telegram_environment");
        else setError(describeError(e, "default"));
      } finally {
        if (!cancelled) setRefreshing(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (refreshing && !me) {
    // Quiet shell during the first /me round-trip — header with a
    // small spinner, body empty. Same pattern the feed uses.
    return (
      <main className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-4">
        <header className="flex items-center justify-between">
          <h1 className="text-foreground inline-flex items-center gap-2 text-xl font-semibold">
            Я
            <RefreshCw className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden />
          </h1>
        </header>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4">
        <EmptyState
          icon={<User className="h-10 w-10" aria-hidden />}
          title="Не вдалось завантажити профіль"
          body={error ?? undefined}
          action={
            <Link
              href="/m/me"
              className="text-primary text-sm underline-offset-2 hover:underline"
            >
              Спробувати ще
            </Link>
          }
        />
      </main>
    );
  }

  const displayName = me.display_name?.trim() || "Анонімно";
  const showName = me.show_name_publicly && me.display_name?.trim();

  return (
    <main className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-4">
      <header className="flex items-center justify-between">
        <h1 className="text-foreground inline-flex items-center gap-2 text-xl font-semibold">
          Я
          {refreshing ? (
            <RefreshCw className="text-muted-foreground h-4 w-4 animate-spin" aria-hidden />
          ) : null}
        </h1>
      </header>

      <section className="bg-card border-border space-y-2 rounded-2xl border p-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary text-primary-foreground flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg font-semibold">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-foreground truncate text-base font-semibold">{displayName}</p>
            <p className="text-muted-foreground inline-flex items-center gap-1 text-sm">
              <MapPin className="h-3.5 w-3.5" aria-hidden />
              {me.city ?? "Місто не вказано"}
            </p>
          </div>
        </div>
        <p className="text-muted-foreground text-xs">
          {showName
            ? "Інші ветерани бачать твоє ім'я серед тих, хто йде."
            : "Ти анонімний — інші бачать тільки кількість."}
        </p>
        <Link
          href="/m/onboarding"
          className="text-primary -mb-1 inline-flex items-center gap-1 text-sm font-medium underline-offset-2 hover:underline"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden />
          Змінити профіль
        </Link>
      </section>

      <section className="space-y-2">
        <SectionHeader title="Найближчі події" />
        {upcoming === null ? (
          <p className="text-muted-foreground text-sm">Завантажуємо…</p>
        ) : upcoming.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            Поки не записаний нікуди. Дивись стрічку — там є чим зайнятись.
          </p>
        ) : (
          <ul className="space-y-2">
            {upcoming.map(({ attendee, opportunity }) => (
              <li key={`${attendee.event_id}-${attendee.user_id}`}>
                <Link
                  href={`/m/event/${attendee.event_id}`}
                  className="bg-card border-border hover:border-primary/40 flex items-center gap-3 rounded-xl border p-3 transition"
                >
                  <CalendarClock className="text-primary h-5 w-5 shrink-0" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground truncate text-sm font-semibold">
                      {opportunity.title}
                    </p>
                    <p className="text-muted-foreground truncate text-xs">
                      {opportunity.start_at
                        ? `${formatEventDateTime(opportunity.start_at)} · ${opportunity.city}`
                        : opportunity.city}
                    </p>
                  </div>
                  <ChevronRight className="text-muted-foreground h-4 w-4" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Button
        type="button"
        variant="outline"
        className="mt-auto"
        onClick={() => {
          logout();
          if (typeof window !== "undefined") window.location.reload();
        }}
      >
        Завершити сесію
      </Button>
    </main>
  );
}
