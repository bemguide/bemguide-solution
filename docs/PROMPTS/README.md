# Поруч — Prompt Pack

Промпты для агентов и для Claude Design. Агенты пока ничего не билдят — это спецификации к работе.

## Файлы

| # | File | Кому | Что внутри |
|---|---|---|---|
| 00 | [Master Brief](./00_MASTER_BRIEF.md) | **всем агентам** — read first | Контекст продукта, stack, scope MVP, 4 персоны, критерии оценки жюри, структура репо |
| 01 | [Backend / Supabase](./01_BACKEND_SUPABASE.md) | Backend agent | Полная схема Postgres, RLS, edge functions skeleton, seed |
| 02 | [AI / Gemini](./02_AI_GEMINI.md) | AI agent | Prompts (system + few-shot) для 4 edge fn: rank / parse / moderate / copy. Guardrails. Evals. |
| 03 | [Web & Mini App](./03_WEB_AND_MINIAPP.md) | Frontend agent | Next.js routes, screens, components inventory, design tokens |
| 04 | [Telegram Bot](./04_TG_BOT.md) | Bot agent | grammY commands, NL-flows, notification templates, initData verify |
| 05 | [Claude Design](./05_CLAUDE_DESIGN.md) | Designer / тебе для v0/Claude | 10 промптов: home feed, event page, onboarding, RSVP modal, admin, propose, illustrations, icons, pitch, logo |

## Как раздавать команде

1. Открой `00_MASTER_BRIEF.md` — пробежись командой вместе, согласуйте scope cut.
2. Раздай 01–04 четырём независимым ветвям работы (или одному агенту последовательно).
3. Дизайн (05) идёт параллельно: Prompt 0 — системка, дальше Prompt 1–10 в отдельных чатах.
4. Когда backend поднят и edge functions деплоятся — frontend подключается. До этого frontend пишет на mock data согласно schema из 01.

## Solid scope cuts если время уходит

- Map view — выкинуть полностью.
- Veteran-created events — оставить только submission, без AI parse (просто структурированная форма).
- Admin moderation — упростить до approve/reject без editing.
- Post-event survey — без peer-quote pipeline, только эмодзи rating.
- Cron notifications — заменить на manual button "Send reminder now" в admin для демо.

## Что нельзя выкидывать ни при каких обстоятельствах

- Public event page без логина (Михайло's flow).
- Onboarding ≤3 questions, skippable.
- AI ranking + "чому це для тебе" copy (criterion 4 — AI integration).
- "Хто йде" social proof line с counts.
- Defer button "Не зараз — нагадай" (anti-paternalism).
- Plain Ukrainian, no English jargon.

## Open questions (решить до старта билда)

См. `User journey + personalization` doc:
1. Privacy default for "хто йде" → counts only by default, opt-in to display name.
2. Moderation SLA → "Зазвичай протягом доби".
3. Past event deep-link → "цей вже відбувся, ось наступна схожа подія".

Плюс новые:
4. Calendar formats — только .ics или ещё native Google Calendar URL? → MVP: .ics + копи "відкрити в Google Calendar" для веба.
5. Admin auth — Supabase magic link или прямо Telegram login? → MVP: magic link, проще.
6. SMS fallback — в scope MVP? → Нет, только Telegram.
