// Root entrypoint. Decides where to send the user based on backend state:
//
//   start_param=evt_<id>   → /m/event/<id>          (deep link, bypass profile check)
//   start_param=defer_<id> → /m/feed                (deferred RSVP, also bypass)
//   any other case         → /m/feed                (default — feed is the home)
//   no Telegram env        → "Open in Telegram" CTA
//
// Why feed is always the default (even for fresh users): the feed is
// the most accessible surface — it answers "what's around me right
// now" with zero setup. New users used to be redirected straight into
// onboarding, which front-loaded ~14 questions before the user could
// see what the app was actually for. Now they land on the feed; the
// onboarding link is a soft banner inside the feed itself, so the
// user opts in once they've seen what they're trying to personalise.
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
        // SDK is reliably loaded by the time this resolves. We don't
        // *use* the user object here — feed is the default regardless
        // — but we still need /me to fire so the auth handshake
        // completes before the feed page itself queries the API.
        await getCurrentUser();
        if (cancelled) return;

        const start = getStartParam();
        if (start.startsWith("evt_")) {
          router.replace(`/m/event/${start.slice(4)}`);
          return;
        }
        // Both `defer_<id>` and the no-param case land on the feed.
        // Onboarding is reachable from the feed (banner) and from
        // /m/me, so we never force-redirect new users into it.
        router.replace("/m/feed");
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
  // Native-app splash: just the wordmark, vertically centered. No
  // spinner, no copy. The decide() effect resolves in 200–500ms in
  // the happy path; anything beyond that is a backend issue and we
  // fall through to ErrorScreen.
  return (
    <main
      className="bg-background mx-auto flex w-full max-w-md flex-col items-center justify-center"
      style={{
        minHeight: "var(--tg-viewport-stable-height, 100dvh)",
        paddingTop: "var(--tg-safe-area-inset-top, 0px)",
        paddingBottom: "var(--tg-safe-area-inset-bottom, 0px)",
      }}
      aria-busy
      aria-label="Поруч"
    >
      <h1 className="text-foreground text-4xl font-semibold tracking-tight">Поруч</h1>
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
