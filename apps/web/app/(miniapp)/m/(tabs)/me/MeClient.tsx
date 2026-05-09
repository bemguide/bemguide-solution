// Profile tab. Stale-while-revalidate against /me + /me/upcoming +
// the TG photo, all merged into a single localStorage entry. Tab
// switches paint the full profile instantly from cache (avatar +
// city + privacy + upcoming list); the network refetch happens in
// the background and swaps when fresh data lands.
//
// Avatar source priority:
//   1. Telegram `initDataUnsafe.user.photo_url` (Bot API 7.0+)
//   2. First letter of display_name in a teal circle (fallback)

"use client";

import { useEffect, useState } from "react";
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
import { getTgUser, getTgUserWithWait } from "@/lib/telegram/client";
import { formatEventDateTime } from "@/lib/format";
import { EmptyState } from "@/components/poruch/EmptyState";
import { SectionHeader } from "@/components/poruch/SectionHeader";

export function MeClient() {
  // SSR-safe defaults; cache + TG photo are loaded inside useEffect.
  const [me, setMe] = useState<V2User | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[] | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // No `ranRef` guard: a useRef-backed flag persists across React
    // strict-mode unmount/remount, which combined with the
    // `cancelled` closure gate poisoned the in-flight fetch from
    // mount #1 and skipped the work on mount #2. Net result was a
    // blank profile until manual reload. Letting strict-mode fire
    // both mounts is fine — both /me + /me/upcoming are idempotent
    // GETs, and prod doesn't double-mount.
    let cancelled = false;

    // Hydrate everything we can synchronously, in this exact order
    // so the very first paint is fully populated:
    //   1. Cache → me, upcoming, photoUrl (the previous fetch's data)
    //   2. SDK photo_url if it's already loaded (covers the fresh-
    //      login case where there's no cache yet but TgInit has run).
    const cached = readMeCache();
    if (cached) {
      setMe(cached.user);
      if (cached.upcoming) setUpcoming(cached.upcoming);
      if (cached.photo_url) setPhotoUrl(cached.photo_url);
    }
    const tgPhoto = getTgUser().photoUrl;
    if (tgPhoto) setPhotoUrl(tgPhoto);

    // Async fallback for the photo: if the SDK wasn't ready
    // synchronously, poll (up to 3s) and update once it lands.
    if (!tgPhoto) {
      void (async () => {
        const u = await getTgUserWithWait();
        if (!cancelled && u.photoUrl) setPhotoUrl(u.photoUrl);
      })();
    }

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
        writeMeCache({
          user: meRes,
          upcoming: upRes.items,
          photoUrl: tgPhoto ?? cached?.photo_url ?? null,
        });
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
