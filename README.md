# Поруч

Telegram Mini App + web platform that helps Ukrainian veterans find local events and community. Built for a 36-hour hackathon.

## Stack

- **Next.js 16** (App Router, TypeScript strict, Tailwind 4) on Vercel.
- **Supabase** (Postgres, Auth, Storage, Edge Functions in Deno).
- **grammY** Telegram bot deployed as a Supabase Edge Function.
- **Gemini** (`gemini-3.1-flash-lite-preview` for ranking/copy, `gemini-3-flash-preview` for moderation/parse).
- **shadcn/ui** + custom `components/poruch/*` for product surface.

## Layout

```
apps/web/         Next.js: public event pages, miniapp (/m/*), admin panel (/admin/*)
supabase/
  migrations/     SQL schema + RLS
  functions/      Deno edge functions (bot, rsvp-create, ics-generate, notify-scheduler, gemini-*)
  seed/           Seed scripts (events, orgs, ghost RSVPs)
packages/shared/  Zod schemas + constants shared between web and edge functions (via deno npm: imports)
docs/PROMPTS/     Source-of-truth specs for each subsystem
```

## Quick start

```bash
pnpm install
cp .env.example .env.local           # fill in real values
pnpm db:link                          # link to Supabase project
pnpm db:push                          # apply migrations
pnpm seed                             # populate events + ghost RSVPs
pnpm fn:deploy                        # deploy Supabase edge functions
pnpm dev                              # start Next.js
```

## Scripts

| Command                        | What it does                                                 |
| ------------------------------ | ------------------------------------------------------------ |
| `pnpm dev`                     | Run Next.js dev server (`apps/web`).                         |
| `pnpm build` / `pnpm start`    | Production build / serve.                                    |
| `pnpm typecheck` / `pnpm lint` | Per-workspace type checks + lint.                            |
| `pnpm seed`                    | Populate Supabase with seed data.                            |
| `pnpm db:push`                 | Apply migrations to remote Supabase.                         |
| `pnpm fn:deploy`               | Deploy edge functions to Supabase.                           |
| `pnpm tg:webhook:set`          | Register the bot webhook with current `NEXT_PUBLIC_APP_URL`. |

## Specs

All subsystem specs live in [`docs/PROMPTS`](./docs/PROMPTS/). Read [`00_MASTER_BRIEF.md`](./docs/PROMPTS/00_MASTER_BRIEF.md) first.
