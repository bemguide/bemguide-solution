// Always-visible psychological-support hotline strip mounted in
// `(miniapp)/layout.tsx` so it sits above every screen in the flow —
// onboarding, feed, propose, event detail, profile, assistant.
//
// Why always-visible: the audience overlaps heavily with the ~33% of
// veterans showing symptoms of depression, and someone in that state
// may not seek help unless it's quietly there. Passive visibility +
// one-tap call beats a "Help" tab the user has to find.
//
// Number: `0 800 332 800` — Лінія психологічної допомоги ветеранам
// (free, 24/7). International form for the `tel:` link so it works
// from outside Ukraine; the visible label keeps the local readable
// formatting users will recognise.
//
// Touch target: 40px tall — above the 36px Material minimum, just
// under the 44px iOS HIG ideal. Going larger would eat too much of
// the TMA viewport on small screens; users still have the assistant
// tab and the agent's crisis-handoff card as fuller-screen paths.

import { HeartPulse, PhoneCall } from "lucide-react";

const HOTLINE_LABEL = "0 800 332 800";
const HOTLINE_TEL = "tel:+380800332800";

export function SupportBanner() {
  return (
    <a
      href={HOTLINE_TEL}
      aria-label="Зателефонувати на лінію психологічної допомоги ветеранам — 0 800 332 800, безкоштовно, цілодобово"
      className="bg-accent text-accent-foreground border-border/60 hover:bg-accent/80 inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 border-b px-3 text-xs font-medium transition-colors"
      style={{ touchAction: "manipulation" }}
    >
      <HeartPulse className="text-primary h-3.5 w-3.5 shrink-0" aria-hidden />
      <span className="truncate">
        Лінія підтримки <span className="font-semibold">{HOTLINE_LABEL}</span>
        <span className="opacity-70"> · 24/7, безкоштовно</span>
      </span>
      <PhoneCall
        className="text-primary h-3.5 w-3.5 shrink-0"
        aria-hidden
      />
    </a>
  );
}
