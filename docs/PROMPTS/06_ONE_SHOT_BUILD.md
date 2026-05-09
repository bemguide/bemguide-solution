# 06 — One-shot build: как заставить Claude построить всё за раз

## Короткий ответ

Используй **Claude Code** (CLI), не чат. Чат теряет контекст, не имеет полноценного filesystem, не может запускать `supabase db push` и `npm run dev`. Claude Code:
- видит всю файловую систему,
- запускает shell,
- работает многочасовыми сессиями с TodoWrite,
- может откатываться через git.

Для one-shot тебе нужно: **(1) подготовленные секреты**, **(2) пустой git repo с prompt pack внутри**, **(3) один orchestration-промпт сверху**.

## Pre-flight checklist (15 минут перед стартом)

Подготовь до того, как запустишь Claude. Без этого он застрянет на первом же шаге.

1. **Supabase project**
   - Создай проект на supabase.com (free tier ок).
   - Запиши: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`.
   - Установи Supabase CLI локально: `brew install supabase/tap/supabase` + `supabase login`.

2. **Gemini API key**
   - Получи на aistudio.google.com → API key (free tier даёт ~1500 запросов/день flash).
   - Запиши: `GEMINI_API_KEY`.

3. **Telegram bot**
   - В @BotFather: `/newbot` → имя `Поруч (test)`, username `poruch_test_bot`.
   - Запиши: `TG_BOT_TOKEN`.
   - В @BotFather для этого бота: `/setdomain` → твой будущий публичный URL (Vercel preview подойдёт).
   - В @BotFather: `/newapp` для Mini App, привяжи URL.
   - Сгенерируй секрет вебхука: `openssl rand -hex 32` → `TG_WEBHOOK_SECRET`.

4. **Vercel** (или альтернатива)
   - `vercel login`.
   - Создай пустой проект, привяжи к git repo (можно отложить до билда).

5. **Локально**
   - Пустая папка, `git init`.
   - Скопируй в неё всю папку `outputs/` из этого pack под именем `docs/PROMPTS/`.
   - Положи `.env.local.example` со всеми ключами выше (без значений).
   - `claude` — запусти Claude Code в этой папке.

## Orchestration промпт (вставь это первым сообщением в Claude Code)

> Скопируй блок ниже целиком. Замени `<...>` плейсхолдеры на свои значения. Это **единственное** сообщение, которое ты пишешь Claude в начале.

```
You are the tech lead and only engineer building "Поруч" — a Telegram-Mini-App + web platform that helps Ukrainian veterans find local events and community. You have 36 hours and one shot.

CONTEXT TO READ FIRST (in this exact order, before writing any code):
1. docs/PROMPTS/00_MASTER_BRIEF.md — product, stack, scope, personas, success criteria.
2. docs/PROMPTS/01_BACKEND_SUPABASE.md — schema, RLS, edge functions, seed.
3. docs/PROMPTS/02_AI_GEMINI.md — all Gemini prompts and integration.
4. docs/PROMPTS/03_WEB_AND_MINIAPP.md — Next.js app spec, all screens.
5. docs/PROMPTS/04_TG_BOT.md — bot commands, flows, notifications.
6. docs/PROMPTS/05_CLAUDE_DESIGN.md — visual language for components.

After reading: summarize back to me in 10 bullets what you understood and the order you'll build in. Wait for my "go" before writing any code.

ENVIRONMENT (already in .env.local):
SUPABASE_URL=<...>
SUPABASE_ANON_KEY=<...>
SUPABASE_SERVICE_ROLE_KEY=<...>
SUPABASE_DB_URL=<...>
GEMINI_API_KEY=<...>
TG_BOT_TOKEN=<...>
TG_WEBHOOK_SECRET=<...>
PUBLIC_BASE_URL=https://<your-vercel-preview>.vercel.app

EXECUTION RULES:
1. Use TodoWrite as your single source of truth. Maintain a top-level todo list reflecting all milestones; update after every task.
2. Build in this strict order so each layer is testable before the next:
   M1. Repo skeleton (apps/web, supabase/, packages/shared) + tooling (tsconfig, tailwind, eslint, prettier).
   M2. Supabase schema (migrations 0001 + 0002), apply with `supabase db push`. Verify tables exist.
   M3. Seed (30+ events, 5+ orgs, 100+ ghost RSVPs). Run, verify counts in Supabase.
   M4. Edge functions infra: _shared/gemini.ts client, _shared/initdata.ts verifier, deployed empty stubs.
   M5. Gemini prompts + 4 edge functions wired. Run eval suite (`deno test`). Must pass before continuing.
   M6. Telegram bot edge function with `/start`, `/me`, `/cancel`. Set webhook. Send a test message to yourself, confirm round-trip.
   M7. Web: design tokens (palette, typography, spacing) → base shadcn components → poruch components inventory.
   M8. Web: public event page `/event/[slug]` working with seeded data. Lighthouse mobile ≥90.
   M9. Web: miniapp onboarding `/m/onboarding` + feed `/m/feed` (with gemini-rank wired).
   M10. Web: miniapp event page `/m/event/[slug]` + RSVP confirm modal. Calendar .ics download works.
   M11. Bot: notification scheduler cron + 4 notification templates. Test with manually-inserted notifications row.
   M12. NL propose flow (bot + miniapp `/m/propose`).
   M13. Admin panel: inbox + moderation card + audit log. Magic link auth.
   M14. Final: deploy to Vercel, set webhook to live URL, smoke test all 4 persona walkthroughs end-to-end.
   M15. Write docs/DEMO_SCRIPT.md with click-by-click for stage demo + docs/PROGRESS.md.

3. After each milestone: git commit with message "M<N>: <what shipped>". Do not start the next milestone until the current one is verified end-to-end.

4. When you hit ambiguity, prefer the most boring, well-trodden choice. Do not invent abstractions. Do not add libraries not listed in 00_MASTER_BRIEF.md without asking.

5. Never invent facts in AI output. Never use English jargon in UI. Never add militaristic copy. These are non-negotiable per Master Brief.

6. If a milestone takes >2x estimated time or you hit a blocker that requires my decision, STOP and ask. Do not silently degrade scope. Specifically ask for guidance on:
   - Anything requiring an account I haven't set up.
   - Any tradeoff between scope cuts listed in docs/PROMPTS/README.md.
   - Any choice between two prompts in 02 or 05 that contradict each other (flag the contradiction).

7. After every 3 milestones, run a self-review: open the latest git diff, check it against the relevant prompt file's Acceptance Criteria, list any gaps. Write the gap list to docs/PROGRESS.md and address before continuing.

8. Verification gates before declaring "done":
   - All 4 persona walkthroughs pass on seeded data (script in 00_MASTER_BRIEF.md § "Что считается успехом демо").
   - `npm run build` clean. `supabase functions deploy` clean. `vercel deploy` clean.
   - Lighthouse mobile ≥90 on /event/[slug] and /m/feed.
   - Demo script runs in <8 minutes for all 4 personas.

START NOW: read the 6 prompt files, then summarize back to me in 10 bullets and wait for "go".
```

## Что делать пока Claude работает

- **Не перебивай первые 30 минут**, пока он читает спеки и поднимает скелет. Это самая важная часть — ему нужно загрузить контекст в голову.
- **Отвечай быстро на блокеры.** Когда Claude спросит "выбрать A или B" — отвечай в 1-2 минуты, иначе он простаивает.
- **Каждые 30-60 минут** проси: `git log --oneline | head -20` и `cat docs/PROGRESS.md`. Это твой dashboard, а не воспоминания Claude.
- **Если контекст-окно начнёт переполняться** (Claude станет хуже помнить решения) — останови, попроси `Compact context: write to docs/STATE.md what's done, what's next, what decisions we made, then start fresh in a new session`. Затем `claude --resume` или новая сессия с инструкцией прочитать `docs/STATE.md` + продолжить.

## Реалистичные ожидания

| Что | Сколько займёт у Claude one-shot |
|---|---|
| M1 — M5 (skeleton + DB + AI infra) | 2-3 часа |
| M6 — M10 (bot + 3 главных экрана) | 4-6 часов |
| M11 — M13 (notifications + propose + admin) | 3-5 часов |
| M14 — M15 (deploy + demo script) | 1-2 часа |
| **Итого** | **10-16 часов work, ~24h wall clock с твоими ответами** |

**Что точно сломается и потребует ручных правок:**
- Telegram webhook setup (нужно вручную в @BotFather проверить).
- Supabase RLS policies — почти всегда нужна 1-2 итерации.
- Gemini structured output — иногда возвращает невалидный JSON, нужно подкрутить retry.
- Vercel env vars — Claude напишет код, но переменные ты сам кладёшь через UI.

**Что не получится в one-shot:**
- Полировка визуала. Дизайн будет рабочий, но "функциональный". Под презентацию пройди руками по каждому экрану 1 час.
- Бесшовный demo. Будут 2-3 краевых случая, которые ты найдёшь только при репетиции пича.
- Реальные фото событий. Поставь Unsplash placeholders, перед демо замени на 3-5 правдоподобных.

## Альтернативные стратегии (если one-shot не работает)

**Стратегия A — Параллельные сессии Claude Code (быстрее).**
Открой 3 окна Claude Code в одном репо на разных git branches:
- Window 1: backend (M2-M6) на `branch/backend`.
- Window 2: web (M7-M10) на `branch/web`, использует mocked supabase types.
- Window 3: bot+admin (M11-M13) на `branch/bot`.

Каждые 2 часа merge в main, разрешай конфликты вручную. Экономит ~30% времени, добавляет ~20% координационного оверхеда. Стоит того, если у тебя есть второй человек, который смотрит за сессиями.

**Стратегия B — Pair с Claude через chat (медленнее, контролируемее).**
Если не хочешь автономии — Claude Code в `--print` mode + ты сам копируешь код. Дольше в 3 раза, но ты видишь каждое решение. Не рекомендую для 36-часового хакатона.

**Стратегия C — Cowork (этот интерфейс).**
Этот интерфейс не подходит для full build — нет git, ограниченный shell, нет долгих сессий. Используй его для **планирования** (как сейчас) и для **демо-материалов** (pitch deck, sketches), но не для основного билда.

## Если Claude в one-shot всё-таки сдох на середине

1. `git status` — посмотри, что недоделано.
2. `cat docs/PROGRESS.md` — где он остановился.
3. Новая сессия Claude Code:
   ```
   Continue building "Поруч" — read docs/PROMPTS/00_MASTER_BRIEF.md, then docs/PROGRESS.md.
   The previous session stopped at <milestone>. Resume from there.
   First action: review git log + current state of the repo, write me a 5-bullet plan to finish, wait for "go".
   ```

Это работает в 90% случаев. Если совсем застрял в одном файле — скопируй файл + соответствующую секцию из prompt pack в новый чат с Claude чисто для этого файла.
