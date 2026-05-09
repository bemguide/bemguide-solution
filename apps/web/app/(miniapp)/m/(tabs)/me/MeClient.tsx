// Profile tab. Stale-while-revalidate against /me — read the
// localStorage cache on mount, fire the fetch in parallel with
// /me/upcoming, swap when fresh data lands. Avoids the wall of
// skeleton on every "Я" tap.
//
// Avatar source priority:
//   1. Telegram `initDataUnsafe.user.photo_url` (Bot API 7.0+)
//   2. First letter of display_name in a teal circle (fallback)
//
// No top header — the bottom tab bar already says we're on the
// profile.

"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  describeError,
  getCurrentUser,
  getUpcoming,
  isNoTelegramEnv,
  logApiError,
  readMeCache,
  writeMeCache,
  type UpcomingItem,
  type V2User,
} from "@/lib/api";
import { getTgUserWithWait } from "@/lib/telegram/client";
import { formatEventDateTime } from "@/lib/format";
import { EmptyState } from "@/components/poruch/EmptyState";
import { SectionHeader } from "@/components/poruch/SectionHeader";

export function MeClient() {
  // SSR-safe defaults; cache + TG photo are loaded inside useEffect.
  const [me, setMe] = useState<V2User | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ranRef = useRef(false);

  useEffect(() => {
    if (ranRef.current) return;
    ranRef.current = true;

    let cancelled = false;

    // Hydrate-from-cache (post-mount → SSR safe). If anything is
    // there, the page paints with real content while the network
    // refetch runs in the background.
    const cached = readMeCache();
    if (cached) setMe(cached);

    // Pull TG photo_url separately so even unauth'd / first-time
    // users get an avatar before /me resolves.
    void (async () => {
      const tgUser = await getTgUserWithWait();
      if (!cancelled && tgUser.photoUrl) setPhotoUrl(tgUser.photoUrl);
    })();

    async function load() {
      try {
        const [meRes, upRes] = await Promise.all([
          getCurrentUser(),
          getUpcoming().catch(() => ({ items: [] })),
        ]);
        if (cancelled) return;
        setMe(meRes);
        writeMeCache(meRes);
        setUpcoming(upRes.items);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        logApiError("me", e);
        if (!cached) {
          if (isNoTelegramEnv(e)) setError("no_telegram_environment");
          else setError(describeError(e, "default"));
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  // Skeleton only when we have nothing at all (no cache, no fetch yet).
  if (!me && !error) {
    return (
      <main className="flex flex-1 flex-col gap-5 overflow-y-auto px-4 pb-6 pt-6">
        <div className="bg-card border-border h-32 w-full animate-pulse rounded-xl border" />
        <div className="bg-muted h-4 w-32 animate-pulse rounded" />
        <div className="space-y-2">
          <div className="bg-card border-border h-16 w-full animate-pulse rounded-xl border" />
          <div className="bg-card border-border h-16 w-full animate-pulse rounded-xl border" />
        </div>
      </main>
    );
  }

  if (!me) {
    return (
      <main className="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-6">
        <EmptyState
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
    <main className="flex flex-1 flex-col gap-6 overflow-y-auto px-4 pb-6 pt-6">
      <ProfileCard
        photoUrl={photoUrl}
        displayName={displayName}
        city={me.city}
        showNamePublicly={Boolean(showName)}
      />

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
                  className="bg-card border-border hover:border-primary/40 block rounded-xl border p-3 transition"
                >
                  <p className="text-foreground truncate text-sm font-semibold">
                    {opportunity.title}
                  </p>
                  <p className="text-muted-foreground truncate text-xs">
                    {opportunity.start_at
                      ? `${formatEventDateTime(opportunity.start_at)} · ${opportunity.city}`
                      : opportunity.city}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

    </main>
  );
}

function ProfileCard({
  photoUrl,
  displayName,
  city,
  showNamePublicly,
}: {
  photoUrl: string | null;
  displayName: string;
  city: string | null;
  showNamePublicly: boolean;
}) {
  return (
    <section className="bg-card border-border flex flex-col items-center gap-3 rounded-xl border px-5 py-6 text-center">
      <Avatar photoUrl={photoUrl} displayName={displayName} />
      <div className="space-y-0.5">
        <p className="text-foreground text-lg font-semibold leading-tight">{displayName}</p>
        {city ? (
          <p className="text-muted-foreground text-sm">{city}</p>
        ) : (
          <p className="text-muted-foreground text-sm italic">місто не вказано</p>
        )}
      </div>
      <p className="text-muted-foreground max-w-xs text-xs leading-snug">
        {showNamePublicly
          ? "Інші ветерани бачать твоє ім'я серед тих, хто йде."
          : "Ти анонімний — інші бачать тільки кількість."}
      </p>
      <Link
        href="/m/onboarding"
        className="text-primary mt-1 text-sm font-medium underline-offset-2 hover:underline"
      >
        Змінити профіль
      </Link>
    </section>
  );
}

function Avatar({
  photoUrl,
  displayName,
}: {
  photoUrl: string | null;
  displayName: string;
}) {
  const [errored, setErrored] = useState(false);
  const initial = displayName.charAt(0).toUpperCase();

  if (photoUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoUrl}
        alt=""
        onError={() => setErrored(true)}
        className="bg-muted h-20 w-20 rounded-full object-cover"
        referrerPolicy="no-referrer"
      />
    );
  }
  return (
    <div
      className="bg-primary text-primary-foreground flex h-20 w-20 items-center justify-center rounded-full text-3xl font-semibold"
      aria-hidden
    >
      {initial}
    </div>
  );
}
