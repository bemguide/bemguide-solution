// Mobile-app bottom tab bar for the (tabs) route group.
//
// Tab order: feed / propose / assistant / me. The "Помічник" tab is
// gated on `NEXT_PUBLIC_AGENT_BASE_URL` — when the agent backend
// isn't configured (local-only dev, prod before the integration is
// live, etc.) we fall back to the original three-tab grid so the
// surface still works without surfacing a broken tab.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { MessageCircleQuestion, Plus, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { getAgentBaseUrl } from "@/lib/agent";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const FEED_TAB: Tab = { href: "/m/feed", label: "Стрічка", icon: Sparkles };
const PROPOSE_TAB: Tab = {
  href: "/m/propose",
  label: "Запропонувати",
  icon: Plus,
};
const ASSISTANT_TAB: Tab = {
  href: "/m/assistant",
  label: "Помічник",
  icon: MessageCircleQuestion,
};
const ME_TAB: Tab = { href: "/m/me", label: "Я", icon: User };

export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  const tabs: Tab[] = getAgentBaseUrl()
    ? [FEED_TAB, PROPOSE_TAB, ASSISTANT_TAB, ME_TAB]
    : [FEED_TAB, PROPOSE_TAB, ME_TAB];
  const cols = tabs.length === 4 ? "grid-cols-4" : "grid-cols-3";
  return (
    <nav
      className="bg-background border-border/60 shrink-0 border-t"
      aria-label="Основна навігація"
    >
      <ul className={cn("grid", cols)}>
        {tabs.map((tab) => {
          const active =
            pathname === tab.href || pathname.startsWith(`${tab.href}/`);
          const Icon = tab.icon;
          return (
            <li key={tab.href}>
              <Link
                href={tab.href}
                aria-current={active ? "page" : undefined}
                style={{ touchAction: "manipulation" }}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors",
                  active
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-5 w-5" aria-hidden />
                <span className="truncate leading-none">{tab.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
