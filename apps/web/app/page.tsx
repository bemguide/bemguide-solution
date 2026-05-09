// Root entrypoint. Decides where to send the user based on backend state:
//
//   start_param=evt_<id>   → /m/event/<id>          (deep link, bypass profile check)
//   start_param=defer_<id> → /m/feed                (deferred RSVP, also bypass)
//   me.city set            → /m/feed                (returning user)
//   me.city null           → /m/onboarding          (new user, finish profile)
//   no Telegram env        → "Open in Telegram" CTA
//
// The (miniapp) layout (which adds TgInit + TMA viewport sizing) is
// scoped to /m/* routes, so we mount TgInit here too — without it
// the SDK never loads and `getCurrentUser` waits forever.

"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Sparkles } from "lucide-react";
import { TgInit } from "./(miniapp)/TgInit";
import { getStartParam } from "@/lib/telegram/client";
import {
  describeError,
  getCurrentUser,
  isNoTelegramEnv,
  logApiError,
} from "@/lib/api";

type State =
  | { kind: "deciding" }
  | { kind: "no_tg" }
  | { kind: "error"; message: string };

export default function HomePage() {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "deciding" });

  useEffect(() => {
    let cancelled = false;

    async function decide() {
      try {
        // First call also drives ensureAuth → POST /auth/telegram.
        // SDK is reliably loaded by the time this resolves.
        const me = await getCurrentUser();
        if (cancelled) return;

        const start = getStartParam();
        if (start.startsWith("evt_")) {
          router.replace(`/m/event/${start.slice(4)}`);
          return;
        }
        if (start.startsWith("defer_")) {
          router.replace("/m/feed");
          return;
        }

        // `city` is the canonical "did this user finish onboarding?"
        // signal — every other field has a non-null default
        // (interests=[], company_preference='any', etc.) but city
        // stays null until the user sets it.
        router.replace(me.city ? "/m/feed" : "/m/onboarding");
      } catch (e) {
        if (cancelled) return;
        logApiError("/", e);
        if (isNoTelegramEnv(e)) {
          setState({ kind: "no_tg" });
        } else {
          setState({ kind: "error", message: describeError(e) });
        }
      }
    }
    void decide();
    return () => {
      cancelled = true;
    };
  }, [router]);

  if (state.kind === "no_tg") {
    return (
      <>
        <TgInit />
        <OpenInTelegramScreen />
      </>
    );
  }

  if (state.kind === "error") {
    return (
      <>
        <TgInit />
        <ErrorScreen message={state.message} />
      </>
    );
  }

  return (
    <>
      <TgInit />
      <DecidingScreen />
    </>
  );
}

function DecidingScreen() {
  return (
    <main
      className="bg-background mx-auto flex w-full max-w-md flex-col items-center justify-center gap-4"
      style={{
        minHeight: "var(--tg-viewport-stable-height, 100dvh)",
        paddingTop: "var(--tg-safe-area-inset-top, 0px)",
        paddingBottom: "var(--tg-safe-area-inset-bottom, 0px)",
      }}
      aria-label="Завантажуємо…"
      aria-busy
    >
      <div className="bg-primary text-primary-foreground flex h-14 w-14 items-center justify-center rounded-full text-2xl font-semibold">
        П
      </div>
      <p className="text-muted-foreground text-sm">Готую поруч…</p>
    </main>
  );
}

function OpenInTelegramScreen() {
  const botUsername = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "";
  const deepLink = botUsername ? `https://t.me/${botUsername}?startapp=feed` : null;
  return (
    <main
      className="bg-background mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ minHeight: "var(--tg-viewport-stable-height, 100dvh)" }}
    >
      <div className="bg-primary/10 flex h-12 w-12 items-center justify-center rounded-full">
        <Sparkles className="text-primary h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-foreground text-xl font-semibold">Відкрий у Telegram</h1>
      <p className="text-muted-foreground text-sm">
        Цей застосунок працює всередині Telegram — там ми бачимо твій профіль і показуємо події
        поруч.
      </p>
      {deepLink ? (
        <Link
          href={deepLink}
          className="bg-primary text-primary-foreground mt-3 inline-flex h-12 items-center rounded-full px-6 text-sm font-semibold"
        >
          Відкрити у Telegram
        </Link>
      ) : null}
    </main>
  );
}

function ErrorScreen({ message }: { message: string }) {
  return (
    <main
      className="bg-background mx-auto flex w-full max-w-md flex-col items-center justify-center gap-3 px-6 text-center"
      style={{ minHeight: "var(--tg-viewport-stable-height, 100dvh)" }}
    >
      <div className="bg-destructive/10 flex h-12 w-12 items-center justify-center rounded-full">
        <Sparkles className="text-destructive h-6 w-6" aria-hidden />
      </div>
      <h1 className="text-foreground text-xl font-semibold">Не вдалось підключитися</h1>
      <p className="text-muted-foreground text-sm">{message}</p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="text-primary mt-2 text-sm font-medium underline-offset-4 hover:underline"
      >
        Спробувати ще
      </button>
    </main>
  );
}
