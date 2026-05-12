# Deployment — Vercel Cron

This subproject deploys as a **standalone Vercel project** (not as a function inside the parent Next.js app). One serverless endpoint, one cron schedule, fully isolated.

## TL;DR

```bash
cd serverless/event-discovery
pnpm install
vercel link               # answer "no" when asked to use existing project
vercel env add CRON_SECRET production           # paste a long random string
vercel env add OPENAI_API_KEY production
vercel env add TAVILY_API_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_KEY production
vercel deploy --prod
```

That's it. Vercel reads `vercel.json` and registers the cron on its own.

## What Vercel deploys

```
event-discovery/
├── api/cron.ts          ← becomes the serverless function (route: /api/cron)
├── lib/*.ts             ← bundled with the function
├── vercel.json          ← declares the cron + maxDuration
└── package.json         ← npm deps to install on the serverless container
```

Vercel auto-detects `api/*.ts` files and builds them as Node serverless functions. No framework needed — no Next.js, no Express. Just the file at `api/cron.ts`.

## Cron config (`vercel.json`)

```json
{
  "crons": [
    { "path": "/api/cron", "schedule": "0 4 * * *" }
  ],
  "functions": {
    "api/cron.ts": { "maxDuration": 300 }
  }
}
```

- **Schedule** — standard cron syntax. `0 4 * * *` = 04:00 UTC daily (07:00 Kyiv summer / 06:00 Kyiv winter). Adjust if you want a different hour.
- **`maxDuration: 300`** — required. Default is 60s on Hobby and 60-300s on Pro. Our pipeline runs ~90-180s.

> **Plan requirement:** **Vercel Pro** ($20/month). Hobby caps function timeout at 60s and only allows 1 cron per project. Pro allows 300s + unlimited crons.

## Authentication — `CRON_SECRET`

Vercel sends every cron trigger with header:

```
Authorization: Bearer <YOUR_CRON_SECRET>
```

The endpoint rejects any request without it (returns 401). This prevents the public URL from being a free-for-all trigger.

**Set it once in Vercel:**

```bash
vercel env add CRON_SECRET production
# paste a long random string (e.g. `openssl rand -hex 32`)
```

Or via dashboard: **Project → Settings → Environment Variables**, add `CRON_SECRET` to all environments.

## Required env vars

| Var | Where to get it | Required for |
|---|---|---|
| `CRON_SECRET` | self-generate (`openssl rand -hex 32`) | auth |
| `OPENAI_API_KEY` | platform.openai.com | classify, filter, map |
| `TAVILY_API_KEY` | tavily.com (free tier 1000 credits/mo) | search |
| `SUPABASE_URL` | Supabase dashboard → Project Settings → API | DB writes |
| `SUPABASE_SERVICE_KEY` | Supabase dashboard → Project Settings → API → `service_role` | DB writes (bypasses RLS) |

## Optional tuning (env vars)

| Var | Default | Effect |
|---|---|---|
| `REGION_ID` | `dnipro` | Which region to sync (must exist in `lib/regions.ts`) |
| `TIME_RANGE` | `day` | Tavily time window. `day` matches our 24h cadence |
| `LLM_MODEL` | `gpt-4o-mini` | Override classifier/mapper model |
| `CONCURRENCY` | `5` | Parallel LLM calls. Raise carefully — total budget is 300s |
| `MIN_CONFIDENCE` | `0.5` | Drop classifier output below |
| `DEDUP_LOOKBACK_DAYS` | `7` | How far back to look for already-imported `post_url`s |

## Deploy command flow

```bash
# 1. From repo root, install workspace deps (pnpm picks up serverless/* via pnpm-workspace.yaml)
cd /path/to/bemguide-solution
pnpm install

# 2. Link the serverless project to Vercel
cd serverless/event-discovery
vercel link
# → answer "n" to "Link to existing project?"
# → name it e.g. "bemguide-event-discovery"

# 3. Add env vars (each prompts for a value)
vercel env add CRON_SECRET production
vercel env add OPENAI_API_KEY production
vercel env add TAVILY_API_KEY production
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_KEY production

# 4. Deploy
vercel deploy --prod
```

After deploy, Vercel prints a URL like `https://bemguide-event-discovery.vercel.app`.

## First manual trigger (recommended)

Don't wait 24h to find out it's broken. Trigger manually:

```bash
curl -X POST https://bemguide-event-discovery.vercel.app/api/cron \
  -H "Authorization: Bearer <YOUR_CRON_SECRET>" \
  | jq
```

Expected response:

```json
{
  "ok": true,
  "stats": {
    "region_id": "dnipro",
    "time_range": "day",
    "candidates_searched": 234,
    "candidates_unique": 234,
    "classified": 234,
    "classified_kept": 67,
    "in_dnipro": 18,
    "mapped": 12,
    "deduplicated": 6,
    "inserted": 12,
    "failed": 0,
    "duration_sec": 142
  }
}
```

Numbers vary day-to-day; new content is sparse on quiet days.

## Verify the cron is registered

Vercel Dashboard → Project → **Crons** tab. You should see one entry:

| Path | Schedule | Last run | Status |
|---|---|---|---|
| /api/cron | 0 4 * * * | — | Active |

If you don't see it, check that `vercel.json` was actually deployed (not gitignored or missing).

## Logs and observability

- **Real-time logs:** Vercel Dashboard → Deployments → latest → **Functions** tab → `/api/cron` → "View Logs"
- **Cron run history:** Vercel Dashboard → Crons → click the cron → "Run History" (last 7 days retained on Pro)
- **`SyncStats` JSON** is logged to stdout on every run — grep `[cron] done` in the logs

For longer retention, pipe to Logtail / Axiom / Datadog by adding the integration in Vercel Project → Integrations.

## Local development

```bash
# Smoke test the orchestrator (skips Vercel, hits real OpenAI / Tavily / Supabase)
cd serverless/event-discovery
cp .env.example .env
# fill the same vars as Vercel
pnpm test:local
```

If you want to run the actual `/api/cron` handler locally with the Vercel runtime:

```bash
pnpm dev          # = vercel dev
# in another terminal:
curl -X POST http://localhost:3000/api/cron \
  -H "Authorization: Bearer <CRON_SECRET>"
```

## Cost in production (per cron / per month)

- **OpenAI:** ~$0.08 per run × 30 runs = **~$2.40/mo**
- **Tavily:** 80 credits/run × 30 = 2400/mo. Free tier (1000) **insufficient**, need [Bootstrap plan ~$20/mo](https://tavily.com/pricing) for 4000 credits
- **Vercel Pro:** $20/mo per team
- **Supabase:** Free tier covers this volume
- **Photon, Nominatim:** $0
- **Total:** **~$42-45/mo for one region, daily**

Per additional city, OpenAI grows linearly (+$2.40), Tavily grows linearly (+800 credits), Vercel stays flat (one cron per region, all on the same project).

## Troubleshooting

**`401 Unauthorized` on manual curl** — `CRON_SECRET` not set in Vercel env, or your Bearer header doesn't match. Check `vercel env ls`.

**`Function timeout after 60s`** — you're on Hobby plan. Upgrade to Pro, or split the pipeline (e.g., separate cron entries per region).

**`Tavily 401`** — wrong/expired API key. `TAVILY_API_KEY` should start with `tvly-`.

**`Supabase insert error: violates check constraint "opportunities_duration_requires_start"`** — bug regression in mapper. Check `lib/map-event.ts` enforces `duration_min=null when start_at=null` (lines around `// DB constraint`).

**`Photon error: 400`** — Photon doesn't support `lang=uk`. Make sure the URL doesn't include any `lang=` param (we removed it).

**Empty cron run (0 inserted) every day** — `time_range=day` may be too tight for your sources. Try `TIME_RANGE=week` and Vercel-deploy again.

**Duplicates appearing in Supabase** — check `DEDUP_LOOKBACK_DAYS` env. Default 7. If you skip a few days of cron runs, dedup window may not cover the gap; raise to 14 or 30.

## Rollback

```bash
vercel rollback         # reverts to previous deployment
```

Or via dashboard: Deployments tab → previous deployment → "Promote to Production".
