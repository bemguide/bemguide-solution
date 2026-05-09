// Adds the BottomTabBar to /m/feed, /m/propose, /m/me. Routes that
// shouldn't show the tab bar (onboarding, event detail) live outside
// this group.
//
// The (miniapp) layout already pins the surface to a single TMA
// viewport with `overflow-hidden`. Here we lay out a flex column:
// the page content scrolls inside `flex-1`, the tab bar stays
// pinned at the bottom (and clears the iOS home indicator via the
// `--tg-safe-area-inset-bottom` padding the parent layout applied).

import { BottomTabBar } from "@/components/poruch/BottomTabBar";

export default function TabsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full flex-1 flex-col overflow-hidden">
      <div className="flex flex-1 flex-col overflow-hidden">{children}</div>
      <BottomTabBar />
    </div>
  );
}
