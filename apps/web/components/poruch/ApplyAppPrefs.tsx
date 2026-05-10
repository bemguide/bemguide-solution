// Reads the saved `AppPrefs` from localStorage on mount and pushes
// them onto <html> so font scale / dark mode / colour-blind palette
// take effect across the app. No UI.
//
// Renders a layout-effect on the client so the application happens
// before paint of the next render — minimises the flash of light-mode
// content for users who picked dark mode in onboarding. (A full FOUC
// fix would require an inline <script> in <head>; the layout-effect
// here is the lightweight version that doesn't break SSR.)

"use client";

import { useLayoutEffect } from "react";
import { applyAppPrefs, loadAppPrefs } from "@/lib/app-prefs";

export function ApplyAppPrefs() {
  useLayoutEffect(() => {
    applyAppPrefs(loadAppPrefs());
  }, []);
  return null;
}
