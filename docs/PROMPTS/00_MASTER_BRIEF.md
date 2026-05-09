# Поруч — Master Brief (для всех агентов)

> Read this first. Каждый сабагент должен начинать с этого файла, потом читать свой профильный (`01_…`, `02_…` и т.д.).

## 1. Что строим

**Поруч** — продукт, который выводит украинским ветеранам **конкретные локальные офлайн-активности и сообщества "тут и сейчас"**, без бюрократии и без необходимости самим искать. Канонический сценарий за ≤60 секунд:

> Ветеран открывает Telegram-мини-апп → видит "Завтра 18:00, футбол з ветеранами, 12 хв від тебе, 4 хлопці вже йдуть" → одна кнопка "Я буду".

Это **не** агрегатор ссылок, **не** психологический бот, **не** кризисный сервис. Это lightweight discovery + RSVP + peer-social-proof loop поверх курируемого каталога офлайн-событий.

## 2. Три актора

1. **Ветеран** — конечный пользователь. Доступ через Telegram (бот + Mini App) и публичные web-страницы событий (без логина, для шеринга).
2. **Заклад / Організатор** — небольшое заведение, ГО, библиотека, реабилитационный центр. Регистрирует себя и подаёт события через Telegram-форму или web. Не tech-человек.
3. **Адмін / Модератор** — нетехнический оператор (1-2 человека от Мінветеранів или ГО). Модерирует входящие события через web admin panel. Видит лог и аналитику.

## 3. Stack (зафиксировано)

| Слой | Выбор | Заметки |
|---|---|---|
| DB / Auth / Storage / Realtime | **Supabase** (Postgres) | RLS обязательна. Никакого Airtable. |
| Edge Functions | **Supabase Edge Functions (Deno)** | Все серверные мутации и Gemini-вызовы здесь. |
| Web frontend | **Next.js 15 (App Router) + TypeScript + Tailwind** | Деплой Vercel. Один codebase обслуживает и публичные web-страницы, и Telegram Mini App. |
| Telegram Bot | **grammY (Deno) на Supabase Edge Function через webhook** | Один bot обслуживает всех акторов; разные команды по роли. |
| Mini App | **Telegram WebApp SDK поверх того же Next.js** | Authentication через `initData` (HMAC verify on edge). |
| AI provider | **Google Gemini** (`gemini-3.1-flash-lite-preview` для ранжирования и копирайта, `gemini-3-flash-preview` для модерации/парсинга) | API key только на edge, никогда в клиенте. |
| Email/SMS fallback | Resend (email) для модераторов; SMS — out of scope MVP | Ветеранов уведомляем только в Telegram. |
| Аналитика | Supabase + 1 dashboard view в admin panel | PostHog/Mixpanel — out of scope MVP. |

## 4. Кого мы обслуживаем (4 канонические персоны)

Все фичи проверяются "пройдёт ли это {persona}". Если ломается хоть на одной — переделываем.

| Persona | Возраст / контекст | Ключевой барьер | Канал входа | Critical UX-фича |
|---|---|---|---|---|
| **Дмитро** | 33, контрактник 5 міс. вдома | психо-эмоц. + інфо | Telegram-чат побратимов (push от ГО) | "Хто ще йде" (имена тех, кто похож на него) |
| **Катерина** | 27, медик ЗСУ, демобилизована | идентичность ("чи я взагалі ветеран") | Instagram repost от women-vet community | Identity-aware filter (жіночі групи как first-class) |
| **Михайло** | 46, ампутация, протез | физический + інфо | Жена шерит ссылку через Viber | Event page работает БЕЗ логина; accessibility-флаги — first-class |
| **Василь** | 52, райцентр Полтавщина | гео + цифровой | QR с флаера в районной администрации | Plain-language NL вход, большие кнопки, AI парсит "шось без інтернету" |

## 5. Scope MVP (что должно работать к демо)

**MUST (ядро демо):**
- [ ] Veteran onboarding: 3 вопроса max, skip-able. Deep-link onboarding (минимум полей).
- [ ] Home feed: 3 секции ("Сьогодні і завтра поруч" / "Цього тижня у [місто]" / "Спробуй щось нове"), AI-ранжирование L0-L4.
- [ ] Event page: публичный URL, accessibility-strip, "хто йде" (counts по умолчанию), CTA "Я буду" + "Поділитися" + "Не зараз, нагадай через тиждень".
- [ ] RSVP loop: запись через bot DM, .ics calendar, QR-код для своих, T-24h + T-10min reminders.
- [ ] Post-event survey: 3 эмодзи + опциональный peer-quote.
- [ ] Veteran-created events: AI-form в боте, попадает в очередь модерации.
- [ ] Organizer flow: Telegram-form для регистрации заведения и подачи событий.
- [ ] Admin moderation panel (web): inbox, AI pre-screen score, approve/edit/reject, audit log.
- [ ] Seed data: 3 города (Київ, Львів, Дніпро) × 8-12 реалистичных событий каждое + 3-5 ghost-RSVPs на событие, чтобы социальное доказательство не было пустым на демо.

**SHOULD (если есть время):**
- [ ] Map view (events на карте, фильтр accessibility).
- [ ] Peer quote pipeline (отзыв ветерана T+24h → модерация → показ на следующей итерации события).
- [ ] Cross-platform share (генерация Telegram/Viber-нативных сообщений с deep-link).

**OUT OF SCOPE MVP:**
- Верификация ветеранского статуса через Дію (упомянуть как roadmap).
- Push в SMS / email для ветеранов.
- Веб-аналитика (PostHog), реферальные награды, геймификация.
- Multi-language (только украинский в UI).
- Платные события / биллинг.

## 6. Гайды, которые нужно соблюдать всем агентам

### Тон UI
- Только украинский в UI-копи. Никаких английских слов / жаргона / "fancy formatting".
- Plain language. Короткие предложения. Без "Ваш аккаунт", без "Привет, друг!".
- Никакого милитари (камо, звания, "слава героям"). Тон — спокойный, бытовой, уважительный.
- "Збір", не "загін". "Долучитися", не "записатися в підрозділ".
- Дефер-кнопка ("Не зараз, нагадай через тиждень") должна быть везде, где CTA "Я буду".

### Privacy дефолты
- "Хто йде" по умолчанию — counts only ("12 ветеранів іде"). Имя показываем только если ветеран явно opt-in в профиле.
- Telegram ID — только server-side. Никогда не попадает в публичную event-page.
- Accessibility-флаги ветерана — никогда не агрегируются и не показываются другим.

### Defaults UX
- Все reminder-toggles — opt-out, default-on, видимый switch.
- Geo — auto-detect через Telegram, override через city dropdown.
- Все события default бесплатные. Если платное — большой бейдж "Платно" + цена.

### AI policy
- AI **ранжирует** и **переписывает**, никогда не **придумывает** события. Любое событие в фиде — реальная запись из Supabase.
- Каждый AI-вывод, который видит ветеран (например "чому саме це"), должен быть основан на реальных полях профиля и события. Никаких галлюцинаций.
- AI-копирайт всегда проходит через "guardrail prompt" с правилами тона (см. `02_AI_GEMINI.md`).
- Все Gemini-вызовы идут через `supabase/functions/gemini/*` с retry + fallback (если API недоступен — деградируем до non-AI ranking по гео + категориям, и просто скрываем "чому саме це").

### Что считается успехом демо
1. Время от тапа "Open" до видимого релевантного события для каждой из 4 персон ≤ 60 секунд.
2. Один полный сценарий (Дмитро): открытие → onboarding 30 сек → home feed → event page → "Я буду" → bot-confirm → reminder симуляция → post-event 👍.
3. Wife-mediated flow (Михайло): открыли event-page без логина в браузере → шарили в Viber → перешли с другого устройства → minimal onboarding → "Я буду".
4. Veteran-created event: ветеран в боте говорит "хочу шахи в суботу 14:00 у Гадячі" → AI парсит → попадает в очередь модератора → модератор approves → событие на лайве.

## 7. Структура репозитория (договорились так)

```
poruch/
├── apps/
│   ├── web/                  # Next.js 15 app: публичные event pages, miniapp, admin
│   │   ├── app/
│   │   │   ├── (public)/event/[slug]/page.tsx
│   │   │   ├── (miniapp)/feed/page.tsx
│   │   │   ├── (miniapp)/onboarding/page.tsx
│   │   │   ├── (miniapp)/event/[slug]/page.tsx
│   │   │   ├── (miniapp)/me/page.tsx
│   │   │   ├── (admin)/admin/inbox/page.tsx
│   │   │   ├── (admin)/admin/event/[id]/page.tsx
│   │   │   └── (organizer)/org/new-event/page.tsx
│   │   ├── components/ui/    # shadcn/ui base
│   │   ├── components/poruch/  # product components: EventCard, AccessibilityStrip, WhoIsGoing, etc.
│   │   ├── lib/supabase/
│   │   ├── lib/telegram/     # initData verify, miniapp helpers
│   │   └── lib/gemini/       # client to edge function (NOT direct API)
│   └── bot/                  # grammY bot — but deployed as Supabase Edge Function
│       └── (mirror of supabase/functions/bot/)
├── supabase/
│   ├── migrations/           # SQL миграции, см. 01_BACKEND_SUPABASE.md
│   ├── functions/
│   │   ├── bot/              # Telegram webhook
│   │   ├── gemini-rank/      # ранжирование событий
│   │   ├── gemini-parse-event/  # парсит NL → event draft
│   │   ├── gemini-moderate/  # pre-screen
│   │   ├── gemini-copy/      # "чому це для тебе", reminder copy
│   │   ├── rsvp-create/
│   │   ├── ics-generate/
│   │   ├── notify-scheduler/ # cron: T-24h, T-10min, T+24h
│   │   └── _shared/
│   └── seed/
│       ├── events.ts         # 30+ событий
│       ├── orgs.ts
│       └── ghost_rsvps.ts
├── packages/
│   └── shared/               # типы Zod-схемы, общие константы
├── design/                   # Figma exports, скриншоты, palette
└── docs/
    ├── PROMPTS/              # эта папка с prompt pack
    └── DEMO_SCRIPT.md        # сценарий для жюри
```

## 8. Что делать прямо сейчас (для агентов)

1. Прочитать этот файл.
2. Прочитать профильный prompt-файл по своей роли:
   - **Backend agent** → `01_BACKEND_SUPABASE.md`
   - **AI agent** → `02_AI_GEMINI.md`
   - **Frontend agent** → `03_WEB_AND_MINIAPP.md`
   - **Bot agent** → `04_TG_BOT.md`
   - **Designer (Claude Design)** → `05_CLAUDE_DESIGN.md`
3. Перед написанием первой строки кода — описать в 5-10 пунктах, что именно будете делать, и согласовать с тимлидом.
4. После каждой завершённой подзадачи — обновить `docs/PROGRESS.md` (создать, если нет).

## 9. Критерии оценки жюри (помним постоянно)

- **Релевантность** — чёткий боль, понятная гипотеза, реально закрывает проблему.
- **Ветеранский контекст** — нет патернализма, минимум кроков, инклюзивность.
- **MVP** — рабочий прототип, core flow без багов.
- **Интеграция AI** — AI решает реальную задачу (ранжирование + парсинг + персонализация), а не "для галочки", и работает в demo.
- **Презентация** — биль → контекст → решение → демо → next steps.

Если фича не помогает ни одному из этих пунктов — выкидываем.
