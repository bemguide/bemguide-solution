// Mobile-app bottom tab bar for the (tabs) route group.
//
// Tab order:  propose / feed / assistant / me. The personalised feed
// tab — labelled "Для тебе" — sits between «Запропонувати» and
// «Помічник» per spec v2 §6.1. The "Помічник" tab is gated on
// `NEXT_PUBLIC_AGENT_BASE_URL`: when the agent backend isn't
// configured (local-only dev, prod before the integration is live,
// etc.) we fall back to a three-tab layout so the surface still
// works without surfacing a broken tab.
//
// Icons are inlined hand-tuned SVGs rather than lucide-react. Lucide's
// generic 2.0-stroke set reads as Material Design dump against the
// warm-cream + brand-tinted palette here; custom paths let us use a
// 1.7 stroke and add an explicit filled-on-active variant so the bar
// has a confident "you are here" anchor without a heavy chip behind
// the icon. Active state: filled icon (where it makes sense), primary
// color, semibold label, and a 32×2px primary bar at the very top of
// the cell — read at a glance without adding visual weight.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { getAgentBaseUrl } from "@/lib/agent";

type IconProps = { active: boolean };

function PlusIcon({ active }: IconProps) {
  // Rounded square + plus — reads as "create / add" without the
  // bare lucide `+` floating in space.
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.375rem] w-[1.375rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.1 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="3.25" y="3.25" width="17.5" height="17.5" rx="5.5" />
      <path d="M12 8.25v7.5M8.25 12h7.5" />
    </svg>
  );
}

function SparkleIcon({ active }: IconProps) {
  // Four-point star — the only icon that fully fills on active because
  // a stroked star looks unfinished next to filled siblings, while
  // filling reads as "lit up" / "for you".
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.375rem] w-[1.375rem]"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 3.5l2.1 5.5 5.5 2.1-5.5 2.1L12 18.7l-2.1-5.5-5.5-2.1 5.5-2.1z" />
    </svg>
  );
}

function ChatIcon({ active }: IconProps) {
  // Speech bubble with a tail. The three dots inside (typing indicator
  // shape) are dropped on active because they'd disappear into the
  // filled bubble; the tail alone still reads as "chat".
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.375rem] w-[1.375rem]"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M5 4.5h14a2.5 2.5 0 0 1 2.5 2.5v8a2.5 2.5 0 0 1-2.5 2.5h-7l-4.5 3.5v-3.5H5A2.5 2.5 0 0 1 2.5 15V7A2.5 2.5 0 0 1 5 4.5z" />
      {!active && (
        <g fill="currentColor" stroke="none">
          <circle cx="8.5" cy="11" r="1" />
          <circle cx="12" cy="11" r="1" />
          <circle cx="15.5" cy="11" r="1" />
        </g>
      )}
    </svg>
  );
}

function UserIcon({ active }: IconProps) {
  // Head + shoulders. Shoulders drawn as a half-ellipse-ish curve so
  // it doesn't look like a generic avatar circle — the slight slope
  // gives it body, more "you" than "default user".
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[1.375rem] w-[1.375rem]"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4 20.5c0-4.5 3.6-7.5 8-7.5s8 3 8 7.5" />
    </svg>
  );
}

type Tab = {
  href: string;
  label: string;
  Icon: React.ComponentType<IconProps>;
};

const PROPOSE_TAB: Tab = {
  href: "/m/propose",
  label: "Запропонувати",
  Icon: PlusIcon,
};
const FEED_TAB: Tab = { href: "/m/feed", label: "Для тебе", Icon: SparkleIcon };
const ASSISTANT_TAB: Tab = {
  href: "/m/assistant",
  label: "Помічник",
  Icon: ChatIcon,
};
const ME_TAB: Tab = { href: "/m/me", label: "Я", Icon: UserIcon };

export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  // "Для тебе" must sit between «Запропонувати» and «Помічник». When
  // the assistant tab is hidden (no agent backend), put propose on
  // the left and feed in the middle so the bar still feels balanced.
  const tabs: Tab[] = getAgentBaseUrl()
    ? [PROPOSE_TAB, FEED_TAB, ASSISTANT_TAB, ME_TAB]
    : [PROPOSE_TAB, FEED_TAB, ME_TAB];
  const cols = tabs.length === 4 ? "grid-cols-4" : "grid-cols-3";

  return (
    <nav
      // Frosted-glass effect when the browser supports backdrop-filter
      // (every modern browser including iOS WKWebView ≥ 13). Falls back
      // to the solid background otherwise so the bar never goes
      // see-through on older WebViews.
      className={cn(
        "shrink-0 border-t border-border/50 bg-background/95",
        "supports-[backdrop-filter]:bg-background/75 supports-[backdrop-filter]:backdrop-blur-xl",
      )}
      aria-label="Основна навігація"
    >
      <ul className={cn("relative grid", cols)}>
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.Icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                style={{
                  touchAction: "manipulation",
                  WebkitTapHighlightColor: "transparent",
                }}
                className={cn(
                  // h-16 (vs the previous h-14): icon + label both want
                  // breathing room above the home-indicator inset, and
                  // a slightly taller bar reads as more confident on
                  // mobile.
                  "group relative flex h-16 flex-col items-center justify-center gap-1 text-[0.6875rem] font-medium tracking-tight",
                  // Subtle press-scale + colour fade. Material's
                  // "scale-feedback" rule — confirms a tap landed
                  // before the next route paints, so users don't
                  // wonder if their tap registered on a slow load.
                  "transition-[color,transform] duration-150 ease-out active:scale-[0.96]",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {/* Active marker: a 32×2 px bar pinned to the very top
                    of the cell. Better than a pill behind the icon —
                    less visual chrome, and on iPhones with a notched
                    home indicator the eye is already drawn upward, so
                    a top marker beats a bottom marker for clarity. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-1/2 top-0 h-[2px] w-8 -translate-x-1/2 rounded-full bg-primary",
                    "transition-opacity duration-200",
                    active ? "opacity-100" : "opacity-0",
                  )}
                />
                <span
                  className={cn(
                    "transition-transform duration-200",
                    // Tiny pop on active. Subtle — visible without
                    // looking jumpy — and gives the bar a touch of
                    // life when switching tabs.
                    active && "scale-[1.06]",
                  )}
                >
                  <Icon active={active} />
                </span>
                <span
                  className={cn(
                    "leading-none",
                    active && "font-semibold",
                  )}
                >
                  {tab.label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
