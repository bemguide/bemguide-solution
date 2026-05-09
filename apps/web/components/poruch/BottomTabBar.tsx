// Mobile-app bottom tab bar for the (tabs) route group.
//
// Three equal-width tabs: feed / propose / me. Active tab gets the
// primary teal; inactive tabs use muted-foreground so the eye lands
// on where you are without straining. Sized to clear the iOS home
// indicator inside fullscreen TMA via the (miniapp) layout's
// `--tg-safe-area-inset-bottom` padding.

"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Plus, Sparkles, User } from "lucide-react";
import { cn } from "@/lib/utils";

type Tab = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
};

const TABS: Tab[] = [
  { href: "/m/feed", label: "Стрічка", icon: Sparkles },
  { href: "/m/propose", label: "Запропонувати", icon: Plus },
  { href: "/m/me", label: "Я", icon: User },
];

export function BottomTabBar() {
  const pathname = usePathname() ?? "";
  return (
    <nav
      className="bg-background border-border/60 shrink-0 border-t"
      aria-label="Основна навігація"
    >
      <ul className="grid grid-cols-3">
        {TABS.map((tab) => {
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
