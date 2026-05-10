# Поруч Personal Assistant — Agent Team Spec

> Audience: the agent team that will build the AI assistant integrated into the Поруч (BemGuide) Telegram Mini App. This spec defines the bar, the user model, the capabilities, the integration contract, and the evaluation methodology. The frontend and core backend (`apps/web/`, `supabase/`) are already built — the agent team owns a **separate backend service** (the "agent backend") that Поруч calls over HTTP/SSE.
>
> Read first: `docs/PROMPTS/00_MASTER_BRIEF.md` for product context, `docs/V2_BACKEND_CONTRACT.md` for the existing API style, `docs/SCHEMA.md` for the user/event schema we expose to you.

---

## 1. TL;DR

We are building an AI agent that helps Ukrainian veterans navigate post-service life — government benefits, paperwork, health, housing, employment, family support — and beats `veteranpro.gov.ua/ai-chat-bot` on every dimension that matters: **accuracy, personalization, empathy, actionability**.

The agent is:

- **Personalized** — uses the veteran's Поруч profile (status, region, accessibility, family, history of asked questions, attended events) to give answers that fit *this* person, not "veterans in general."
- **Smart** — multi-step reasoning, tool use, retrieval over live government and NGO sources with citations.
- **Helpful** — doesn't just answer, drives action: drafts the application, deep-links to Дія, books a callback with a hotline, suggests a peer support group on Поруч.
- **Trauma-informed** — calm, plain language, validates, never bureaucratic, respects the user's `triggers_to_avoid`.
- **Integrated as an external backend** — Поруч calls `POST /v1/agent/messages` and streams the response. Auth, profile data, and conversation memory all flow through this contract.

Hard target: **agent wins ≥80% of pairwise human evals** against VeteranPro on a curated 200-question set across accuracy, specificity, empathy, and actionability.

---

## 2. Mission and bar

VeteranPro (`veteranpro.gov.ua/ai-chat-bot`) is a generic RAG chatbot over government documentation. It answers "what is OIBB?" with policy paraphrase. That's necessary but not sufficient.

A veteran asking "як отримати протез коліна, якщо я з Полтавщини, мама не ходить, машини нема" needs:

1. **The actual procedure** — which order, what documents, where to apply, deadlines.
2. **Personalized to them** — Полтавська область specifics, not Київ-defaults; mobility-aware answer (no "приходьте в офіс особисто" if they can't); recognizes "мама не ходить" implies they're a caregiver and may have additional benefits.
3. **Next step** — a working link, a phone number, a button to start the application, *not* "зверніться у відповідні органи."
4. **Honest about uncertainty** — when policy is ambiguous or recently changed, say so and offer to escalate.
5. **Continuity** — next time they come back, the agent remembers what they asked, what they already submitted, what's pending.

VeteranPro fails on 2–5. We win there.

| Dimension | VeteranPro baseline | Поруч agent target |
|---|---|---|
| Accuracy (cited from law/decree) | ~70% (LLM judge) | ≥95% with source link |
| Specificity (uses user's profile) | 0% (no profile) | ≥80% of answers reference at least one user-fact |
| Empathy (trauma-informed tone) | Bureaucratic | Validated by 5+ veteran reviewers |
| Actionability (concrete next step) | "Зверніться в ОІВВ" | Working URL/phone/button in ≥90% of answers where one exists |
| Refusal handling | Hallucinates | Says "не знаю" + escalates |
| Continuity | Stateless | Cross-session memory, user-editable |

---

## 3. Personas and jobs-to-be-done

The four canonical personas from `docs/PROMPTS/00_MASTER_BRIEF.md` each have AI-assistant-specific jobs:

### Дмитро (33, контрактник, 5 міс. вдома)
- **Why he opens the chat:** "Як оформити УБД? Я не розумію куди йти."
- **Jobs:** procedural walkthroughs, "what am I entitled to" inventory, peer-validation ("чи нормально що…")
- **Anti-jobs:** medical diagnosis, lectures about PTSD

### Катерина (27, медик ЗСУ, демобілізована)
- **Why she opens the chat:** "Чи я взагалі ветеран? Я медик, не воювала з автоматом."
- **Jobs:** identity confirmation, women-veteran-specific benefits, gender-disaggregated answers
- **Anti-jobs:** assumptions about "men's combat experience"

### Михайло (46, ампутація, протез)
- **Why he opens the chat:** "Чи покриває держава новий протез через 3 роки? І хто приходить додому, бо я сам не доїду."
- **Jobs:** disability benefits depth, home-visit services, accessibility-aware navigation, appeal letters when refused
- **Anti-jobs:** anything that requires physical mobility without offering an alternative

### Василь (52, райцентр Полтавщини)
- **Why he opens the chat:** "Шось чув про доплату 100 тисяч, але не знаю де питати."
- **Jobs:** plain-language explanations, voice input, phone-call-as-fallback, large-tap UI, region-specific answers (not Kyiv defaults)
- **Anti-jobs:** dense legal text, English jargon, multi-step web flows that assume PC literacy

Every feature is checked: does it pass for all four? If it breaks for one — redesign.

### Top JTBD coverage (V0)

The MVP must answer these classes of question correctly and personally:

1. **Eligibility** — "Чи положено мені X?" (UBD, disability percentage, family-of-fallen, etc.)
2. **Procedure** — "Як оформити X? З чого почати?"
3. **Documents** — "Які документи потрібні? Де їх взяти?"
4. **Status & timing** — "Куди дивитися статус заявки? Скільки чекати?"
5. **Money** — "Скільки мені виплатять? Коли? Що з оподаткуванням?"
6. **Health & rehab** — "Куди звернутися з PTSD / травмою / реабілітацією?"
7. **Family** — "Що положено сім'ї? Дітям? Дружині загиблого?"
8. **Housing** — "Як отримати житло / компенсацію оренди?"
9. **Education** — "Безкоштовна вища освіта / курси перекваліфікації?"
10. **Employment** — "Підтримка з працевлаштуванням / бізнесом?"
11. **Crisis** — "Я не справляюсь / погані думки" → human escalation, no AI therapy.
12. **Local & social** — "Де зустрітися з такими ж?" → cross-link to Поруч feed.

---

## 4. Personalization model

The agent has read access to the veteran's Поруч profile. Every answer must be conditioned on this context.

### Profile fields available (from `docs/SCHEMA.md`'s `users` table)

```ts
{
  // From onboarding — already collected:
  city: string,                          // jurisdiction
  display_name: string | null,
  age_range: "18-25"|"26-35"|"36-45"|"46-55"|"56+" | null,
  veteran_status: "active"|"reservist"|"combatant"|"wounded"|"family_of_fallen"|null,
  role_in_group: string | null,          // self-described "what I bring"
  bio: string | null,                    // free-text, ≤500 chars
  interests: InterestCategory[],
  accessibility_flags: AccessibilityFlag[],  // mobility, hearing, vision, sensory
  triggers_to_avoid: string[],           // free-text tags
  schedule_constraints: string | null,   // "догляд за дитиною", etc.
  availability: string[],
  company_preference: "any"|"women_only"|"men_only"|"mixed_quiet",
}
```

### Agent-managed (new — owned by the agent backend)

```ts
{
  // Cross-session memory, user-controllable
  facts: [
    { kind: "service_branch", value: "ЗСУ, медрота",   added_at: ts, source: "user_said" },
    { kind: "dependents",     value: "донька 8р.",     added_at: ts, source: "user_said" },
    { kind: "applied_for",    value: "УБД 2024-12",    added_at: ts, source: "agent_inferred" },
    { kind: "pending_status", value: "очікую виплату", added_at: ts, source: "user_said" },
  ],
  // What we last told them (avoid repeating, surface continuity)
  recent_topics: [{ topic, last_message_at, summary }],
  // Active threads (open applications, deadlines)
  threads: [{ kind, started_at, expected_resolution_at, latest_status }],
}
```

The agent shows the user their stored facts, lets them edit/delete (right-to-be-forgotten by design — Tier 0 requirement). Stored in the agent backend, not in Поруч's Supabase. Sync direction is one-way (Поруч → agent reads profile; agent does NOT write to Поруч's user table).

### Profile gaps to fill (open question for the team)

Onboarding doesn't currently ask about:

- Service branch / unit / years served
- Wound / disability percentage (if any)
- Dependents (spouse, children, elderly parents)
- Current employment / income source
- Region of residence (we have city, may need oblast)
- Whether they've already filed for UBD / which benefits

Decision needed: extend onboarding (longer flow, but better answers) vs progressive disclosure (ask in-conversation when needed). Recommendation: progressive disclosure — keep onboarding short, ask in-flow.

---

## 5. Capability tiers

Three shipping tiers. Each tier is **independently demoable** and **must beat VP on its slice** before unlocking the next.

### V0 — Information & Navigation (MVP, 4–6 weeks)

What ships:

- Multi-turn chat over RAG of:
  - Закон України "Про статус ветеранів війни"
  - Постанови КМУ (cabinet decrees) for veteran services
  - Накази Мінветеранів
  - VeteranPro's content corpus (consumed as a baseline, then improved)
  - diia.gov.ua services catalog
- **Citations on every factual claim** — title, source, URL, date.
- **Personalization** — every answer references at least the user's `city`, `veteran_status`, and (if relevant) `accessibility_flags`.
- **Crisis & refusal flows** — see §8.
- **Hotline & NGO escalation** — when the agent doesn't know or it's beyond its scope, it surfaces verified human resources (Гаряча лінія Ветеранів `15-65`, Veteran Hub, Pobratymy).
- **Conversation memory within a session.**

What does NOT ship in V0:

- Cross-session memory (V1)
- Tool use beyond retrieval (V1)
- Proactive notifications (V2)

Acceptance:

- ≥80% pairwise win on the 50-question seed eval set.
- ≥95% citation coverage on factual claims (LLM judge + spot human review).
- 0 crisis-handling failures on the crisis test set (10 cases, hand-graded).
- p95 first-token latency ≤2s; p95 full-response ≤8s for typical questions.

### V1 — Procedural Assistance (4 weeks after V0)

What ships:

- **Cross-session memory** — facts, recent topics, open threads.
- **Tool use:**
  - `open_diia(service_id)` — deep-link to a Дія service.
  - `call_hotline(number, label)` — surfaces a tap-to-call CTA.
  - `find_event(query)` — searches Поруч's feed, suggests a relevant peer event.
  - `draft_application(kind, fields)` — produces a pre-filled appeal/application template the user can copy.
  - `track_status(application_id)` — where gov't APIs allow, fetch live status.
- **Step-by-step procedural walkthroughs** — multi-message flows ("Крок 1 з 5: …").
- **Profile gap detection** — "you didn't tell me your region, can I ask?" with consent.
- **User-controllable memory UI** — show me what you remember; let me edit/delete.

Acceptance:

- ≥85% pairwise win on the 200-question full eval set.
- ≥70% of users who reach a procedural question take the suggested action (open_diia, save draft, etc.).
- Memory recall: in a 3-session test, the agent correctly applies a fact saved in session 1 to session 3 ≥95% of the time.

### V2 — Proactive & Connected (4 weeks after V1)

What ships:

- **Daily digest** (opt-in): "новини за тиждень для тебе" — only items matching the user's facts (e.g., "новий наказ Мінветеранів про ваші виплати").
- **Deadline reminders** — for active threads, T-7d / T-1d.
- **New-eligibility alerts** — "ти не питав, але цей закон тебе стосується."
- **Mental-health peer-suggestions** — when topic is heavy, surface a Поруч event with peers in similar situation (without breaking anonymity rules).
- **Voice input** — STT for older users, full pipeline UA-language.
- **PDF parsing** — user uploads a refusal letter, agent explains and drafts an appeal.

Acceptance:

- ≥30% of opted-in users engage with at least one digest/week.
- 0 false-positive eligibility alerts on the regression set (we'd rather under-promise).

---

## 6. Architecture

```
┌──────────────────────────┐
│   Telegram Mini App      │
│   (apps/web, Next.js)    │
└──────────┬───────────────┘
           │ HTTPS + Bearer (existing JWT)
           ▼
┌──────────────────────────┐  read-only  ┌──────────────────────────┐
│   Поруч web/edge backend │ ──────────► │  Supabase (users,events) │
│   (existing v2 contract) │             └──────────────────────────┘
└──────────┬───────────────┘
           │ HTTPS + service-token  (NEW)
           ▼
┌──────────────────────────────────────────────────────────────────┐
│                  AGENT BACKEND  (you build this)                 │
│                                                                  │
│   /v1/agent/messages   (SSE stream)                              │
│   /v1/agent/memory     (CRUD on user facts)                      │
│   /v1/agent/threads    (open applications, deadlines)            │
│                                                                  │
│   ┌──────────────┐    ┌──────────────┐    ┌────────────────┐   │
│   │ Orchestrator │ ─► │  Retrieval   │ ─► │ Vector store   │   │
│   │  (LLM core)  │    │  (RAG)       │    │ (gov sources)  │   │
│   └──────┬───────┘    └──────────────┘    └────────────────┘   │
│          │                                                       │
│          ├─► tool: open_diia, call_hotline, find_event, …      │
│          └─► tool: read_profile (Поруч), write_memory, …       │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ├─► LLM provider (Anthropic primary, Gemini fallback)
                              ├─► Дія API (where available)
                              └─► nominatim / external geo (where needed)
```

### Why external backend (not embedded in Supabase Edge)?

- Agent loops with tool use need long-running compute and request-level state — Edge Functions are short-lived.
- Vector store with frequent re-crawl is heavy for Edge.
- Provider/model swaps shouldn't require redeploying the whole product.
- Independent eval pipeline — agent team owns rollout cadence.

### Stack proposal (decide and document in your own ADR)

| Layer | Recommendation | Alternatives |
|---|---|---|
| Runtime | Python (FastAPI) or Node (Hono/Fastify) | Whatever the team owns deepest |
| LLM | Anthropic Claude Sonnet 4.6+ (primary) | Gemini 2.x for cheap eval, fallback |
| Orchestration | Anthropic Agent SDK or own thin loop | LangGraph (ergonomic), Vercel AI SDK |
| RAG store | pgvector (re-uses our Supabase) or dedicated Qdrant/Weaviate | |
| Embeddings | text-embedding-3-large or `multilingual-e5-large` | UA-language coverage matters |
| Streaming | SSE | WS if you need bidi |
| Hosting | Fly.io / Render / GCP Cloud Run | Stay close to Supabase region (eu-central) |
| Observability | OpenTelemetry → Honeycomb/Grafana | Plus per-conversation trace logs |

---

## 7. API contract (agent backend ↔ Поруч)

Match the conventions in `docs/V2_BACKEND_CONTRACT.md` (snake_case, Bearer auth, error envelope).

### Auth

- Поруч's existing token is opaque. Agent backend exchanges it once via:
  - `POST /v1/agent/auth` with `{ poruch_token }` → returns `{ agent_token, expires_at }`
  - Agent backend verifies the token by hitting Поруч's `/me` endpoint, caches user_id + profile snapshot for 5 minutes.
- All subsequent agent calls use `Authorization: Bearer <agent_token>`.

### Streaming chat

```
POST /v1/agent/messages
Authorization: Bearer <agent_token>
Content-Type: application/json
Accept: text/event-stream

{
  "conversation_id": "uuid | null",       // null = start a new one
  "user_message": "як оформити УБД?",
  "client": { "surface": "miniapp", "tg_locale": "uk" }
}
```

Response: `text/event-stream` with these event types:

```
event: conversation
data: {"conversation_id":"abc-123"}

event: token
data: {"text":"Для оформлення УБД "}

event: token
data: {"text":"тобі потрібно подати "}

event: citation
data: {"id":"c1","title":"Постанова КМУ № 415","url":"https://kmu.gov.ua/...","date":"2024-08-01","kind":"decree"}

event: tool_call
data: {"id":"t1","name":"open_diia","args":{"service":"ubd_application"}}

event: tool_result
data: {"id":"t1","ok":true,"display":{"label":"Подати заяву через Дію","url":"https://diia.gov.ua/..."}}

event: action
data: {"kind":"suggest_event","event_id":"e-99","reason":"peer-meetup-this-week"}

event: done
data: {"finish_reason":"end_turn","usage":{"input_tokens":1234,"output_tokens":567}}

event: error
data: {"error":"upstream_timeout","message":"…"}
```

Frontend renders:

- `token` events → append to bubble.
- `citation` → render as superscript chip; opens a sheet with title/source/date.
- `tool_call` → optional spinner ("шукаю…").
- `tool_result` → render the action card (button, deep-link).
- `action` → side-rail card or inline event preview.
- `done` → finalize the message.

### Memory CRUD

```
GET  /v1/agent/memory                    → { facts: [...], recent_topics: [...] }
POST /v1/agent/memory                    body: { kind, value }
DELETE /v1/agent/memory/:fact_id
PATCH /v1/agent/memory/:fact_id          body: { value }
```

User-facing UI in Поруч's `/m/me` page lists facts; user can edit/delete each.

### Conversations

```
GET  /v1/agent/conversations             → list, last 20
GET  /v1/agent/conversations/:id         → messages
DELETE /v1/agent/conversations/:id       → soft-delete
```

### Errors

Same envelope as `V2_BACKEND_CONTRACT.md`:

```json
{ "ok": false, "error": "machine_code", "message": "Текст укр.", "details": {...} }
```

Add codes:

| Code | Meaning |
|---|---|
| `agent_busy` | Concurrent request limit reached for this user |
| `upstream_timeout` | LLM provider timed out |
| `unsafe_input` | Refused per safety policy |
| `crisis_handoff` | Triggered crisis flow — UI must render the human-resources card |

---

## 8. Trust, safety, refusal model

### Hard rules

1. **Never invent a law, decree, or eligibility rule.** Every factual claim has a citation, or the agent says "не знаю напевне — давай уточню" and escalates.
2. **Never give medical advice.** "Почніть приймати X" is forbidden. "Зверніться до сімейного лікаря / до ось цього центру" is fine.
3. **Never echo PII unsolicited.** If the user shares a passport number, RNOKPP, or address, the agent acknowledges but doesn't quote it back. If the user asks "що ти про мене знаєш?", show the user's facts list explicitly.
4. **Never assume gender or veteran-status.** Use the profile, ask if missing.
5. **Respect `triggers_to_avoid`.** Soft-mention or skip; never lecture about why this is a trigger.
6. **No moral judgment** on contested topics (mobilization, evacuation, leaving service early). Hand off to legal counsel resources.

### Crisis flow (Tier 0 requirement)

Triggers (any of):

- Suicidal ideation language ("не хочу жити", "немає сенсу", any explicit verbatim).
- Imminent harm language ("прямо зараз готуюсь", weapons mentions in self-harm context).
- Acute distress + no support markers ("я сам, нікого нема, не справляюсь").

Response:

1. Validate ("я почув тебе. ти не сам.")
2. Surface verified hotline immediately:
   - **Лінія підтримки ветеранів та їхніх родин: `0 800 33 20 29`** (24/7, безкоштовно)
   - **Кризова телефонна лінія: `7333`** (Lifeline Ukraine)
3. Offer in-app peer connect (Поруч event for mental-health peer group, if one matches).
4. Stop the regular flow — no other content until user signals OK.

The crisis card is hard-coded in the agent backend, not LLM-generated. It's surfaced via the `action: crisis_handoff` event so the frontend renders it consistently.

### Refusal categories

The agent refuses (with a one-line reason and an alternative resource):

- Mobilization evasion how-to (point to legal aid)
- Document forgery (point to OP / hotline)
- Personal info about other people (privacy)
- Tactical/operational military info
- Self-harm enablement, even framed as research

It does NOT refuse:

- Hard questions about disability percentage thresholds
- "I'm angry at the state" — engage with empathy
- "Can I refuse mobilization on medical grounds" — yes, factual answer with sources

### Tone guide

- Always Ukrainian (unless user writes in another language; mirror).
- Plain words. No "відповідно до законодавства України" — say "за законом".
- Short sentences. Long answers get bullet lists or numbered steps.
- Address singular informal ("ти"), unless user uses formal ("ви") — mirror.
- No emoji unless quoting the user.
- No "як AI асистент я…". Never break the fourth wall.
- Validate the feeling before answering ("Зрозуміло. Це справді заплутано — давай розберемо.")

---

## 9. Knowledge sources & RAG

### Authoritative sources (must be in the index from day 1)

| Source | Refresh | Format |
|---|---|---|
| Закон України "Про статус ветеранів війни, гарантії їх соціального захисту" | weekly | text + amendments |
| Постанови КМУ — veteran-relevant | daily | text + structured metadata |
| Накази Мінветеранів | daily | text |
| VeteranPro corpus (`veteranpro.gov.ua`) | weekly crawl | HTML + Q&A pairs |
| Diia.gov.ua services catalog | weekly | structured |
| Гаряча лінія Ветеранів knowledge base (if obtainable) | weekly | text |

### NGO content (high-trust partners — license & ingest with permission)

- Veteran Hub (`veteranhub.com.ua`)
- Pobratymy
- Krylia Pidtrymky
- Ветеранський простір
- Lifeline Ukraine

### Indexing approach

- Chunk size 400–800 tokens, 100-token overlap.
- Each chunk tagged: `source_kind`, `jurisdiction` (national/oblast/raion), `topic` (taxonomy below), `effective_date`, `superseded_by`, `language`.
- Embed with a multilingual model that covers Ukrainian well (`multilingual-e5-large` or OpenAI's `text-embedding-3-large`).
- Hybrid retrieval: BM25 + vector → re-rank with a small cross-encoder.

### Topic taxonomy (use as facets)

```
status        — UBD, повторне підтвердження, статус учасника бойових дій
benefits      — фінансові виплати, пільги
health        — реабілітація, протезування, ментальне здоров'я
family        — сім'я загиблого, діти, дружина
housing       — житло, оренда, компенсації
education     — вища освіта, перекваліфікація, гранти
employment    — пошук роботи, бізнес-гранти, ФОП-пільги
documentation — посвідчення, довідки, апеляції
crisis        — гаряча лінія, психологічна допомога
local         — спільнота, події, peer-support
```

### Source freshness contract

- Every chunk has `effective_date`. The agent always retrieves the LATEST version and ignores `superseded_by` chunks unless the user explicitly asks about historical state.
- New decrees flagged and reviewed by a human within 48h before going live in the index.
- Content older than 12 months without re-validation gets a "перевір актуальність" disclaimer in citations.

---

## 10. Evaluation methodology

### Datasets

1. **Seed set (V0 launch):** 50 hand-written real questions from veteran forums, hotline FAQ, Поруч user feedback. Hand-crafted "gold" answers.
2. **Full set (V1):** 200 questions spanning all 12 JTBD categories × 4 personas. Mix of factual, procedural, emotional, edge-case.
3. **Crisis set:** 10 cases — exact phrases drawn from real crisis hotline transcripts (anonymized). All must trigger the crisis flow correctly.
4. **Refusal set:** 20 cases — known refusal categories. All must refuse + escalate correctly.
5. **Personalization set:** 30 cases × 3 profile variations each = 90 traces. Each variant must produce a measurably different (and correct) answer.

### Scoring rubric (per question, 0–4 each, summed)

| Dimension | 0 | 4 |
|---|---|---|
| Accuracy | Wrong fact / hallucinated law | Correct, cited, current |
| Specificity | Generic "depends on situation" | Uses ≥1 user-fact, jurisdiction-aware |
| Empathy | Bureaucratic, lecturing | Calm, validates, plain language |
| Actionability | "Зверніться у відповідні органи" | Working URL/phone/button |
| Refusal handling | Hallucinates when uncertain | "Не знаю" + escalation, when applicable |

### Pairwise eval

Each question is answered by VeteranPro and our agent. A blinded human (veteran or veteran-services pro) picks the better response or "tie." Win-rate is the reportable metric.

Run before every release. Publish results internally. Block release if win-rate drops below the previous release's mark.

### Automated eval

LLM-judge (Claude Opus / GPT-4-class) on the full set, scored against the rubric. Runs on every commit to the agent backend's main branch. Gates merges.

### Live monitoring

- Per-conversation trace ID.
- Sampled human review of 1% of conversations weekly.
- User-side thumbs-up/down on every answer (optional, anonymous).
- Crisis-flow triggers go to a 24/7 on-call channel.

---

## 11. Privacy & data handling

### Data we read (from Поруч)

- User profile fields (see §4)
- User's past Поруч events (interests signal)
- Messages exchanged with the agent in this user's history

### Data we write (in agent backend's own DB)

- Conversation history (per user)
- Agent-managed facts (see §4)
- Open threads (active applications, deadlines)
- Telemetry (aggregate, no PII in logs)

### Retention

- Conversations: kept indefinitely unless user deletes.
- Facts: user-controllable, hard-deleted on request.
- Telemetry: 90 days then aggregated.
- Crisis-flow triggers: trace logged for 30 days for safety review, then purged.

### Deletion

- "Видалити всю історію" button in `/m/me` → cascade-deletes conversations + facts + threads.
- Account deletion in Поруч → propagates to agent backend within 24h via an admin webhook.

### What we don't do

- No selling data, no third-party analytics.
- No model training on user messages without explicit opt-in.
- No sharing of data with government or NGO partners without per-conversation user consent.

### Compliance

- GDPR-aligned (data minimization, right to access, right to erasure, portability).
- Ukrainian data-protection law alignment (ZU "Про захист персональних даних").
- Document Data Processing Agreement with Поруч's legal entity.

---

## 12. Phased delivery

### Phase 0 — Discovery (2 weeks)

- Crawl + index VeteranPro corpus. Build the seed eval set (50 questions).
- Decide: LLM provider, vector store, hosting, observability.
- Map Поруч profile fields to agent context schema.
- ADR document delivered: stack, embedding model, RAG architecture, eval pipeline.
- Decide profile-extension vs progressive-disclosure.

**Deliverable:** ADR + 50-question seed set + first-cut V0 baseline against VP (just retrieval, no agent yet).

### Phase 1 — V0 MVP (4 weeks)

- Implement `POST /v1/agent/messages` with RAG + citations + personalization.
- Implement crisis & refusal flows.
- Beat VP on seed set ≥80%.
- Integrate into Поруч: a new `/m/assist` tab with a chat surface; entry points from `/m/me` (e.g., "запитати про пільги") and `/m/event/[id]` (e.g., "питання перед записом?").

**Deliverable:** working `/m/assist` end-to-end + eval report.

### Phase 2 — V1 Procedural (4 weeks)

- Cross-session memory + user-controllable UI.
- Tool use: open_diia, call_hotline, find_event, draft_application.
- Step-by-step procedural flows.
- Expand eval to 200 questions.

**Deliverable:** procedural walkthroughs + memory.

### Phase 3 — V2 Proactive (4 weeks)

- Daily digest (opt-in).
- Deadline reminders.
- New-eligibility alerts.
- Voice input + PDF parsing.

**Deliverable:** notifications + multi-modal input.

### Phase 4 — Hardening (ongoing)

- Performance: p95 latencies under target.
- Cost: per-user per-month under target (TBD).
- Coverage: all 12 JTBD topics, all 4 personas, all oblasts in scope.

---

## 13. Integration touchpoints (Поруч side)

What we will build on the Поруч frontend after the agent backend is live:

- **`/m/assist` route** — new tab in `BottomTabBar`, chat surface, conversation history.
- **Entry points** — buttons on `/m/me` ("питання про пільги") and `/m/event/[id]` ("сумніваєшся? спитай").
- **Memory UI** — section in `/m/me` showing what the agent remembers, with edit/delete.
- **Profile extensions** — if we decide on extra fields (service branch, dependents, disability %), add to onboarding or progressive in-flow.
- **Crisis handoff card** — fixed component the agent triggers; renders hotline tap-to-call with the canonical numbers above.
- **Notification integration** — V2 digests delivered via the existing Telegram bot, not new channel.

These are tracked in a separate frontend ticket; the agent team's contract is the API in §7.

---

## 14. Open questions

Decisions to make in Phase 0 (week 1):

1. **Profile extension** — extend onboarding (longer, but better answers from minute one) vs progressive disclosure (shorter onboarding, ask in-conversation).
2. **Russian-language fallback** — many veterans Russophone by default. Mirror the user's language? Refuse? Always reply in Ukrainian? **Recommendation:** mirror language for input parsing, always reply in Ukrainian.
3. **Voice input** — required for V2? Older personas need it; younger may not.
4. **Дія API integration** — official APIs for veteran services? If not, scrape + warn-on-stale.
5. **Liability for legal/financial advice** — disclaim? Get sign-off from Мінветеранів? Affiliate-mark all answers?
6. **NGO partnerships** — formal MoUs needed for ingesting NGO content?
7. **Crisis hotline numbers** — confirm with Мінветеранів the canonical 24/7 line. (Current candidate: `0 800 33 20 29`.)
8. **Cost ceiling** — per-user-per-month budget? Drives model choice and caching aggression.
9. **Multi-tenant?** — is this Поруч-only, or do we expose the agent to other veteran-serving apps later? Affects auth boundaries.

---

## 15. Success criteria for the agent team

Phase 0 done when: **ADR shipped, seed set built, baseline measured**.

Phase 1 done when: **V0 wins ≥80% pairwise vs VP on seed set** AND **0 crisis-flow failures** AND **integrated into `/m/assist`** AND **p95 first-token <2s**.

Phase 2 done when: **V1 wins ≥85% on full 200-question set** AND **memory recall ≥95% across sessions** AND **≥70% take-rate on suggested actions**.

Phase 3 done when: **V2 digest engagement ≥30% weekly** AND **0 false-positive eligibility alerts on regression set**.

Anything that ships must:

- Have a citation audit pass (no hallucinated facts).
- Have a refusal-and-crisis test pass (no breakthroughs).
- Have a privacy review pass (no PII leakage in logs / responses).
- Have signed-off Ukrainian copy review (tone, clarity, no English).

---

## 16. Contacts & ownership

- Product owner: Поруч product lead.
- Engineering owner: agent team lead (you).
- Frontend integration: Поруч frontend team (`apps/web`).
- Backend (Поруч): owner of `docs/V2_BACKEND_CONTRACT.md`.
- Ukrainian copy / tone reviewer: TBD (must be a veteran or veteran-services pro).
- Crisis-flow reviewer: TBD (must be a licensed psychologist / hotline operator).
- Legal: TBD (Ukrainian data-protection law + Мінветеранів liaison).

---

End of spec. Iterate via pull requests on this document.
