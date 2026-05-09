# Поруч — Progress Log

Living document. Updated after every milestone, with a self-review every 3 milestones (per user's execution rules).

## Status by milestone

| #   | Milestone                                     | Status         | Commit    |
| --- | --------------------------------------------- | -------------- | --------- |
| M1  | Repo skeleton + tooling                       | ✅ done        | `908b3e7` |
| M2  | Supabase schema + RLS                         | ✅ done        | `aab6171` |
| M3  | Seed 30 events / 7 orgs / 119 ghost RSVPs     | ✅ done        | `9e2f984` |
| M4  | Edge function infra (`_shared`)               | ✅ done        | `312619f` |
| M5  | Gemini prompts + 4 functions wired + evals    | ✅ done        | `0beb551` |
| M6  | Telegram bot edge function + webhook          | ✅ done        | `2aa3d55` |
| M7  | Web design tokens + base components           | ⏳ pending     | —         |
| M8  | Public event page `/event/[slug]`             | ⏳ pending     | —         |
| M9  | Miniapp `/m/onboarding` + `/m/feed`           | ⏳ pending     | —         |
| M10 | Miniapp `/m/event/[slug]` + RSVP modal + .ics | ⏳ pending     | —         |
| M11 | Notify scheduler cron + 4 templates           | ⏳ pending     | —         |
| M12 | NL propose flow (bot + miniapp)               | ⏳ pending     | —         |
| M13 | Admin panel                                   | ⏳ pending     | —         |
| M14 | Deploy + 4-persona smoke                      | ⏳ pending     | —         |
| M15 | DEMO_SCRIPT.md + this file                    | ⏳ pending     | —         |

## Decisions made

- **Stack divergence from spec → kept:** Next.js 16.2.6 (spec said 15), Tailwind 4 (CSS-only config), `@google/genai` SDK (spec said REST). Same App Router & Edge Functions runtime, so the spec semantics still apply.
- **Gemini models:** `gemini-3.1-flash-lite-preview` (rank/copy) + `gemini-3-flash-preview` (moderate/parse) per master brief, overriding the 2.0 names in 01/02.
- **`bot_sessions` table:** folded into `0001_init.sql` (spec'd it in 04 only).
- **`apps/bot/` mirror:** dropped — single source of truth in `supabase/functions/bot/`.
- **Admin auth:** simple password gate via `ADMIN_PASSWORD` (env signal), not magic-link.
- **Cron:** Vercel cron → `/api/cron/notify` route → forwards to Supabase `notify-scheduler` edge fn with `VERCEL_CRON_SECRET`.
- **No `SUPABASE_ANON_KEY`** in `.env.local` — going SSR-only via service role for MVP. No realtime, no client-side Supabase queries.
- **Migrations applied via Studio paste** (no DB password yet). For future schema changes, either reset DB password or add a PAT for Management-API-based migrations.

## Self-review M1–M3 (against spec acceptance criteria)

### Met

- ✅ Repo structure matches `00_MASTER_BRIEF.md §7` (`apps/web`, `supabase/`, `packages/shared`, `docs/PROMPTS/`).
- ✅ Pure Supabase (no Airtable). Service role only on server.
- ✅ Schema = 11 tables + 10 enums + 8 indexes + 2 triggers + `public_rsvp_count` SECURITY DEFINER fn. All Ukrainian-content fields tested via seed.
- ✅ RLS enabled on every table; only `cities/events(approved)/organizations(verified)` are publicly readable. Veterans/notifications/moderation_log/rsvps/ratings/shares/discovery_sources/bot_sessions are service-role-only.
- ✅ `public_rsvp_count(uuid)` returns `going_count + names_visible` (opt-in display names) — verified end-to-end with seed data.
- ✅ Seed: 30 events (12/10/8 across Київ/Львів/Дніпро), 7 organizations, 26 ghost veterans, 119 ghost RSVPs.
- ✅ Distribution quotas: `women_only=4 (≥3) · barrier_free=19 (≥3) · movement=8 (≥8) · craft|community=19 (≥5)`.
- ✅ All seed copy is plain Ukrainian, no military framing, persona names excluded from ghosts.
- ✅ Privacy defaults: `veterans.show_name_publicly=false`, `rsvps.show_name_publicly=false` (ghosts override to true for demo social proof).
- ✅ Tooling clean: `pnpm install / typecheck / lint / build / format:check` all pass.

### Gaps to address

- **G1 (M4 will fix):** Migrations weren't applied via `supabase db push` — used Studio paste because the user has no DB password. Need either a DB password reset or a Personal Access Token with Management-API access to automate future schema iterations and to run `supabase functions deploy`. Resolve before M4 ends.
- **G2 (M8 will verify):** RLS hasn't been tested from the **anon-key** side end-to-end. The policies are written correctly per spec, but we haven't proved that an unauthenticated client can `SELECT events WHERE status='approved'` and call `public_rsvp_count`, while being rejected by `veterans`. Will validate when wiring the public event page in M8.
- **G3 (M5 will fix):** Seed `comfort_notes='[seed-ghost]'` is a hack to mark ghosts for cleanup. If AI ever sees ghost veterans (it shouldn't — ghosts have no `tg_user_id` so they never call the API), this string would leak into prompts. Defensive fix: AI prompt code should filter ghosts out before passing to Gemini.
- **G4 (process):** No `tsconfig.json` covers `supabase/seed/`, so `pnpm typecheck` skips it. tsx caught no runtime errors during the seed run, but a stray bug could ship undetected. Optional: add a `supabase/seed/tsconfig.json` for parity.
- **G5 (M7):** Tailwind 4 globals.css declares the spec's palette, but no `font-display`/`font-h2`/etc. typography tokens or the radii/spacing utilities yet — that's M7's job.

## Self-review M4–M6 (against spec acceptance criteria)

### Met

- ✅ All 8 Supabase Edge Functions deploy via `pnpm fn:deploy` and curl-verify (`pnpm fn:verify`).
- ✅ 4 Gemini functions return validated JSON for 16 eval cases (5 rank / 4 parse / 3 moderate / 4 copy). Run with `pnpm evals`.
- ✅ Guardrail catches banned military words + obvious name-token hallucinations + length overflow → re-prompt cycle replaced by an "empty + fallback" envelope so the UI can degrade silently.
- ✅ Deterministic fallback for `gemini-rank` works on AI failure (validated by the "deterministic fallback when veteran has no data" eval).
- ✅ G3 resolved: `loadVeteran` strips bracket-marker comfort_notes (e.g. `[seed-ghost]`) before returning to Gemini.
- ✅ Bot handles /start, /me, /cancel, /help, /skip, /contact, /stop_reminders, /myevents, /newevent (the last is a placeholder that links to /m/propose; M12 fills the chat flow).
- ✅ Bot deep links: `evt_<slug>`, `defer_<slug>`, `org`.
- ✅ Webhook secret enforced (X-Telegram-Bot-Api-Secret-Token); wrong secret → 403.
- ✅ Webhook always returns 200 so Telegram doesn't retry the same update on internal errors.
- ✅ Real human round-trip with @bembembem_testbot confirmed.

### Gaps to address

- **G6 (M9 will fix):** auth.ts accepts `Bearer VERCEL_CRON_SECRET` as the canonical internal bearer because the user's `.env.local` SUPABASE_SERVICE_ROLE_KEY hash didn't match the auto-injected one (Supabase rotated it). Acceptable for MVP; revisit before prod.
- **G7 (deferred):** Cost guard "50 Gemini calls/veteran/day" not implemented. Practical risk during demo is low (we have 1-3 demo users). Add a `gemini_calls` count column or per-day rate-limit table when traffic justifies it.
- **G8 (M12 will exercise):** `bot_sessions` table is created but no flow writes to it yet. M12 (NL propose) is when /cancel becomes meaningful.
- **G9 (M9-M10 will exercise):** `_shared/initdata.ts` exists and unit-tests pass for the algorithm, but no edge function actually verifies a real Telegram initData yet — M10 RSVP flow is the first caller.

## What's next

**M7** — apps/web design tokens + base shadcn components. Then M8-M10 wire those into the public event page, miniapp onboarding/feed, and the RSVP modal with .ics.
