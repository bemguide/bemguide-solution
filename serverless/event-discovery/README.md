# Event Discovery Cron — `@bemguide/event-discovery`

Standalone Vercel serverless subproject. Runs once every 24 hours (cron job) and adds new veteran-relevant events to Supabase `public.opportunities`. Uses the same 4-stage pipeline as the offline batch tooling — only narrowed to "what's new in the last day".

## Pipeline (per cron invocation)

```
[1] Tavily Search × 1 pass (TIME_RANGE=day)  →  ~150-300 fresh candidates
       │
       ▼
[2] LLM-classifier (gpt-4o-mini)  →  drops news / past / commercial
       │
       ▼
[3] Geo-filter (LLM, strict city only)  →  drops other cities / oblast / abroad
       │
       ▼
[4] Dedup vs last 7 days in Supabase  →  drops post_urls already imported
       │
       ▼
[5] LLM-mapper + Photon geocode  →  Supabase `public.opportunities` insert
```

Per-day expected output: **5-30 new rows** (most days fewer; spikes around announcements).

## 1. Discovery — Tavily Search API

Rather than maintaining bespoke scrapers for FB / IG / NGO sites / TG channels, we use Tavily — a search API designed for AI agents. One call returns top URLs **plus** the page content already extracted.

For the cron we run **only one pass** with `time_range=day` (vs the 9 passes of the historical batch run) — fresh content only, low cost. Query matrix is the same: `40 keywords × 1 region` (10 categories × 2-5 keywords × city). Categories: `sport, adaptive_sport, recreation, nature, creative, community, support_group, family, education, benefit`.

`time_range=day` filters to results indexed in the last 24h, which roughly matches our cron cadence. Some publications take longer than 24h to be indexed, so an event might show up 1-2 days late — fine, we'll catch it on a subsequent run and dedup will drop the second hit.

## 2. LLM-classification

Each candidate → `gpt-4o-mini` with **strict JSON schema**. Returns:

- `is_event` — anchor vs news/report
- `event_temporality` ∈ {`upcoming`, `recurring`, `ongoing`, `past`, `not_event`}
- `audience` ∈ {`veteran_only`, `veteran_priority`, `veteran_benefit`, `community_open`, `not_relevant`}
- `category`, `starts_at`, `venue_text`, `has_benefit`, `confidence`, `relevance_reason`

**Kept if:** `is_event=true` AND `event_temporality ∈ {upcoming, recurring, ongoing}` AND `audience ≠ not_relevant` AND `confidence ≥ 0.5`.

## 3. Geo-filter — strict city only

A second LLM pass enforces "physically in the target city" — drops satellite towns (Кам'янське, Самар, Кривий Ріг, Слобожанське for Dnipro), oblast-level mentions without city, other Ukrainian cities, foreign cities, and nationwide programmes without local tie.

## 4. Dedup against Supabase

Before mapping, we read `opportunities.organizer_contact` for rows created in the last `DEDUP_LOOKBACK_DAYS` (default 7) days, regex-extract URLs, and skip any candidate whose `post_url` is already in that set. Schema didn't have a dedicated `external_url` column, so we ride on `organizer_contact` (which the mapper writes as `post_author · post_url`).

## 5. Mapping into `public.opportunities`

**Deterministic (no LLM):**
- `title` ← title
- `city` ← `DEFAULT_CITY` env (default `Дніпро`)
- `oblast` ← `DEFAULT_OBLAST` env (default `Дніпропетровська`)
- `address` ← `venue_text`
- `photo_url` ← `post_image_urls[0]`
- `location_lat/lng` ← Photon (Komoot OSM, no API key, polite 200 ms throttle, falls back to Dnipro centre `48.4647, 35.0462` if unresolved)

**LLM (gpt-4o-mini, structured output):**
- `start_at` — from `starts_at` if present, else parsed from summary text. URL slugs like `/2026/05/07/` are NOT used (they are publication dates, not event dates). For `ongoing`/`recurring` → `null`.
- `duration_min` — heuristic by category (sport=60, education=120, recreation=null). **Forced to null when `start_at=null`** (DB constraint `opportunities_duration_requires_start`).
- `interests[]` — `[tag_id]` + 1-3 keywords from summary
- `description` — composed from summary + `recurrence_text` + `benefit_text` + audience marker
- `price_uah` — `0` if explicitly free, else parsed amount, else `null`
- `organizer_contact` — `post_author · post_url` + phone/email if present in text

**Skipped in v1 (DB defaults apply):** `accessibility_flags`, `target_age_range`, `target_identity_pref`, `target_veteran_status`. Pending finalised enum values from the schema team.

## Cost-economics per cron run

| Stage | Service | Cost |
|---|---|---|
| Search × 1 pass (40 queries) | Tavily | ~80 credits/day → ~2400/mo (Free tier 1000/mo not enough — plan for ~$20/mo Bootstrap) |
| Classification 150-300 candidates | OpenAI gpt-4o-mini | ~$0.05/day |
| Geo-filter ~50-100 | OpenAI gpt-4o-mini | ~$0.02/day |
| Mapping 5-30 events | OpenAI gpt-4o-mini | ~$0.005/day |
| Geocoding ~5-10 venues | Photon | $0 |
| Supabase | — | $0 (within free tier) |
| **Total per day** | | **~$0.08 + 80 Tavily credits** |

**Per-month projection:** ~$2.40 OpenAI + Tavily Bootstrap $20 = **~$25/mo for one city, daily**.

## Runtime budget

Default Vercel function `maxDuration` is 60 s on Hobby and 300 s on Pro. We set `maxDuration: 300` in `vercel.json`. Typical run takes 90-180 s (Tavily searches dominate). If you push to many regions in one cron, split into separate cron entries (one per region) to keep each under 300 s.

## Deployment

See **[DEPLOYMENT.md](./DEPLOYMENT.md)** for full Vercel setup, env-var configuration, cron schedule, plan requirements, manual-trigger curl, troubleshooting, and rollback.

Quick start:
```bash
cd serverless/event-discovery
pnpm install
cp .env.example .env       # fill OPENAI_API_KEY, TAVILY_API_KEY, SUPABASE_*, CRON_SECRET
pnpm test:local            # smoke test against real APIs
vercel deploy --prod       # ship
```

## Environment variables

| Var | Purpose | Default |
|---|---|---|
| `CRON_SECRET` | Auth header Vercel sends with cron | required |
| `OPENAI_API_KEY` | LLM calls | required |
| `LLM_MODEL` | Override model | `gpt-4o-mini` |
| `TAVILY_API_KEY` | Search API | required |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | DB write | required |
| `REGION_ID` | Which region to sync | `dnipro` |
| `TIME_RANGE` | Tavily lookback | `day` |
| `SEARCH_DEPTH` | Tavily depth | `advanced` |
| `MAX_RESULTS` | Per Tavily query | `20` |
| `CONCURRENCY` | Parallel LLM calls | `5` |
| `MIN_CONFIDENCE` | Drop classifier output below | `0.5` |
| `DEFAULT_CITY` | Inserted as `city` | `Дніпро` |
| `DEFAULT_OBLAST` | Inserted as `oblast` | `Дніпропетровська` |
| `GEOCODE_FALLBACK_LAT/LNG` | When geocoder fails | Dnipro centre |
| `DEDUP_LOOKBACK_DAYS` | How far back to check for duplicate post_urls | `7` |

## Repository layout

```
serverless/event-discovery/
├── api/
│   └── cron.ts             # Vercel handler + auth + maxDuration config
├── lib/
│   ├── tavily.ts           # discovery
│   ├── classify.ts         # LLM event-vs-news classifier
│   ├── filter-region.ts    # LLM strict city filter
│   ├── geocode.ts          # Photon geocoder (no API key)
│   ├── map-event.ts        # LLM mapper to opportunities schema
│   ├── supabase.ts         # client + dedup-by-url helpers
│   ├── orchestrator.ts     # 5-stage pipeline (used by both cron and local-run)
│   ├── regions.ts          # supported regions metadata
│   ├── tags.ts             # 10 categories with UA search keywords
│   └── types.ts            # shared TS types
├── scripts/
│   └── local-run.ts        # invoke orchestrator directly without Vercel
├── mapped.json             # 143 example mapped opportunities from a real run
├── package.json
├── tsconfig.json
├── vercel.json             # cron schedule + maxDuration
├── .env.example
├── DEPLOYMENT.md           # full Vercel deployment guide
└── README.md
```

## `mapped.json` — example output

The 143-row JSON in the project root is a real result from one full pipeline run on Дніпро (May 2026, before this code was modularised into the cron). Each entry is the same shape we insert into Supabase, plus the `post_url` we used for dedup. Use it for:

- **Validating the schema** of `Opportunity` end-to-end without burning API credits
- **Demoing** what the system actually produces (numbers, structure, language quality)
- **Training UI components** against realistic content before the cron has filled the DB

```bash
jq 'length' mapped.json                       # 143
jq '.[0].opp' mapped.json                     # one opportunity row
jq '[.[] | .opp.interests[]] | unique' mapped.json   # all interests we saw
```

**Not** used at runtime — the cron always pulls fresh content from Tavily, never from this file.

## How this is different from the historical batch (`scraper/` + `import-supabase/`)

- **Time horizon:** `time_range=day` (vs `year/week/month` mix in batch)
- **Passes:** 1 (vs 9) — freshness comes from cron cadence, not pass diversity
- **Idempotency:** SQL-side dedup by `organizer_contact` URL match (vs local JSON cache)
- **Geocoder:** Photon (vs Nominatim — banned our IP during batch development)
- **Schema cleanup:** mapper enforces `duration_min=null when start_at=null` to satisfy `opportunities_duration_requires_start`
- **Operator surface:** Vercel dashboard (env vars + cron toggle) — designed for non-technical handover

## Roadmap

- **More regions:** add to `lib/regions.ts`, fan out via separate cron entries (one per region) to stay within 300s per invocation
- **Telegram direct API** via `gramjs`/MTProto for channels Tavily indexes poorly
- **Firecrawl** for the curated 40-NGO shortlist (deeper crawl per source)
- **Enum mapping** (accessibility, age, vet_status) once schema enums are finalised
- **Quality eval:** weekly task that pulls 20 random kept events and emails for human review
- **Observability:** push `SyncStats` to Logtail / Axiom for retention beyond Vercel's 7 days
