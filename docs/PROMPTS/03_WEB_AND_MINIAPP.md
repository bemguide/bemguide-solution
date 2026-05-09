# 03 — Web app & Telegram Mini App

> Prereq: `00_MASTER_BRIEF.md`, `01_BACKEND_SUPABASE.md`. Frontend-агент пишет один Next.js codebase, который обслуживает три surface: публичные event-страницы (для шеринга), miniapp (для ветеранов в боте), admin panel (для модераторов).

## Prompt для frontend-агента

```
You are the frontend engineer for "Поруч". One Next.js 15 codebase serves three surfaces:
1. Public event pages — anyone with a link can view (no login). Goal: shareable, fast, accessible.
2. Telegram Mini App (TMA) — opened from inside Telegram bot. Auth via initData HMAC verify on edge.
3. Admin panel — for 1-2 non-technical moderators. Auth via Supabase magic link.

Stack:
- Next.js 15 App Router, TypeScript strict, Tailwind, shadcn/ui as base, lucide-react icons.
- @supabase/ssr for server-side; @supabase/supabase-js (anon) only for realtime where needed.
- Telegram Web App SDK (window.Telegram.WebApp).
- Form handling: react-hook-form + Zod (shared schemas with backend).
- Maps: @vis.gl/react-google-maps OR Leaflet + OpenStreetMap (prefer Leaflet — no API key).
- Calendar: ics file from edge function; no calendar embed needed.
- i18n: NONE. Ship Ukrainian only.

Constraints:
- Mobile-first. The miniapp is the canonical surface — design at 375px width first, scale up.
- Accessibility: WCAG AA. Tap targets ≥48×48. Color contrast ≥4.5:1 for body text. Honest icons + labels for accessibility flags (icon alone is never enough).
- No client-side Gemini calls. Use Next.js route handlers as a proxy if needed.
- No third-party trackers. No cookies beyond auth.
- Real Telegram initData verification: do NOT trust the client. Send X-Telegram-InitData header to edge functions.

Deliverables:
- apps/web/ Next.js project, deployed-ready.
- All screens listed below, working with seeded Supabase data.
- Lighthouse mobile ≥90 for the home feed and event page.
- One DEMO_SCRIPT.md with click-by-click for the 4 persona walkthroughs.

Begin with: a route map + component inventory + 5-bullet plan. Wait for tech-lead approval.
```

---

## Route map

```
/event/[slug]                                  → public event page (no login)
/m/onboarding                                  → miniapp: 3-question onboarding (skippable)
/m/feed                                        → miniapp: home feed, 3 sections
/m/event/[slug]                                → miniapp: same as public + "чому це для тебе" + RSVP CTA
/m/me                                          → miniapp: profile, my RSVPs, settings
/m/propose                                     → miniapp: AI-assisted event submission
/m/map                                         → miniapp: map view of events with accessibility filter

/org                                           → organizer landing
/org/new-event                                 → organizer event submission form
/org/me                                        → organizer dashboard (my events, RSVPs)

/admin                                         → admin login (magic link)
/admin/inbox                                   → moderation queue
/admin/event/[id]                              → moderation card
/admin/analytics                               → simple dashboard
/admin/audit                                   → moderation log
```

---

## Screens — детально

### A. Public event page `/event/[slug]`

**Цель:** работает без логина, мгновенно открывается из шеринга в Viber/Telegram, дёшево гуглится.

**Layout (top → bottom):**

1. **Hero**: photo (real, лежит в Supabase Storage); поверх — title (h1, 24px), date+time (большая строка), city + address (clickable → Google Maps).
2. **Accessibility strip**: горизонтальная лента иконок с подписью под каждой. Цвет: серо-зелёный для "є", серо-красный для "немає". Например: `♿ безбар'єрно`, `🔇 тиха кімната є`, `🚫 без алкоголю`, `❌ сходи на вході` (красная). Каждая иконка имеет `aria-label` с полным украинским текстом.
3. **"Що там буде"** — описание (2-4 абзаца, plain language).
4. **"Хто йде"** — counter блок: "12 ветеранів іде" + опционально 3-6 имён (если есть opt-in). Аватарки — circle initials (без фото).
5. **"Що з собою"** — bulleted list (если organizer указал).
6. **"Контакти організатора"** — Telegram handle + телефон. Tap → открывает соответствующее приложение.
7. **Sticky bottom CTA bar**:
   - Primary: `Я буду` (открывает /m/event/[slug] если в TMA, иначе deep link в бота `t.me/poruch_bot?start=evt_<id>`).
   - Secondary: `Поділитися` (Web Share API + fallback copy link).
   - Tertiary: `Не зараз — нагадай через тиждень` (если в TMA — schedules deferred RSVP; если public — открывает бот с deep link `?start=defer_<id>`).

**Edge cases:**
- Event already passed: показывает прошедшую карточку приглушённой + блок "Цей вже відбувся, ось наступна схожа: [card]".
- Event status != approved: 404.

**Lighthouse:** preload hero image, defer non-critical CSS, использовать `next/image` с `priority` для hero.

---

### B. Miniapp onboarding `/m/onboarding`

**Поведение:**
- Если deep-link открытие (`tgWebAppStartParam` начинается с `evt_`) — onboarding **пропускаем**, redirect to `/m/event/[slug]`. Минимальные поля (имя) спрашиваем при тапе "Я буду" inline.
- Если cold start — показываем 3 экрана-карты, каждый — один вопрос. Можно `Пропустити` любой.

**Экраны:**

1. **"Де ти зараз?"**
   - Auto-detect: если есть `Telegram.WebApp.initDataUnsafe.user.language_code === 'uk'` и в `initData` есть какой-то city hint — pre-select. Иначе показываем dropdown с городами (default — Київ, Львів, Дніпро в топе, остальные ниже).
   - Кнопка `Далі`.

2. **"Що тобі цікаво?"**
   - Multi-select chips. 8 опций: рух, навчитися чомусь, спільнота, творчість, волонтерити, просто пройтися, читання, з родиною.
   - Минимум 0, максимум 8. Кнопка `Далі`.

3. **"Є щось важливе про комфорт?"**
   - Optional, expandable. Default — collapsed с текстом "це не обов'язково — можна пропустити".
   - Группы:
     - Identity: `жіночі групи` / `змішано` / `можна з близькими`.
     - Accessibility: `безбар'єрний простір`, `тиха обстановка`, `без алкоголю`, `без сходів`, `сурдопереклад`, `аудіоопис`.
     - Free-text: "Що ще варто знати?" (≤200 chars).
   - Кнопка `Готово`.

После каждого шага — оптимистичный POST в edge function `veterans/upsert`.

**Тон копи на этапе onboarding:** одно предложение, без вопросительных знаков, тёплый но не интимный. Например: `"Щоб не показувати тобі речей, які тобі не підходять — скажи коротко"`.

---

### C. Miniapp home feed `/m/feed`

Главный экран. Должен render'иться в ≤1.5s после открытия miniapp.

**Структура:**

1. **Header sticky**: логотип "Поруч" слева, иконка профиля справа. Без поиска (поиск — anti-pattern для нашей аудитории).
2. **Section 1 — "Сьогодні і завтра поруч"**: 3-5 карточек horizontal scroll или vertical stack. Каждая карточка:
   - Photo (16:9, фиксированная высота 120px).
   - Title (16px bold, 2 lines max).
   - Time + distance: "Завтра 18:00 · 12 хв пішки".
   - Accessibility chips (mini-row, ≤3 видимых).
   - Social proof line (12px, серый): "4 ветерани йдуть · перший раз — буде Олег" ИЛИ "Спільнота Львів — провели 12 зустрічей".
   - **AI reason line** (12px, светло-зелёный фон, 1 строка): "Безкоштовно, поруч, тут уже є ветерани твого віку".
3. **Section 2 — "Цього тижня у [твоє місто]"**: 8-12 карточек, vertical scroll. Меньше визуального веса (компактнее: photo 80×80 thumbnail, без AI reason).
4. **Section 3 — "Спробуй щось нове"**: 1-2 карточки с тэгом "Спробуй" + одно предложение "поза твоїми інтересами, але багато ветеранів вже пробували".
5. **Below fold**: ссылка `Більше — на мапі →` (open `/m/map`).
6. **Floating action**: внизу справа — `+` button → `/m/propose` ("Запропонувати свою активність").

**State management:**
- Server component получает feed через `gemini-rank` edge fn (с timeout 3s, fallback на deterministic ranking).
- Client component для refresh-on-pull.

**Empty states:**
- Если в городе ветерана < 3 событий: показываем "У {город} зараз небагато подій. Ось у сусідніх містах:" + расширенный набор.

---

### D. Miniapp event page `/m/event/[slug]`

Тот же layout, что public event page (B), плюс:

- Блок **"Чому це для тебе"** (между Accessibility strip и описанием) — 2-3 строки от gemini-copy. Свернутая иконка `ⓘ` рядом — раскрывает "що ми використали з твого профілю" (transparency commitment).
- CTA bar внизу — большая кнопка `Я буду` (60px высота, full width). Под ней — мелкие `Поділитися`, `Не зараз`.
- После tap "Я буду" → inline modal:
  - Если профиль ещё не имеет `display_name` — спрашиваем "як до тебе звертатися?" (1 input).
  - Confirm screen: "Записав. Нагадаю напередодні і за 10 хв." + три кнопки: `Додати в календар` (downloads .ics), `Мій QR` (модалка с QR), `Як дістатися` (open map).
  - Toggle "Показувати моє ім'я іншим ветеранам у цій події" (default off).

---

### E. Miniapp profile `/m/me`

**Tabs:**
1. **Мої записи** (default): list of upcoming RSVPs + past with rating shortcut.
2. **Налаштування**: edit interests / accessibility / identity_prefs / display_name / show_name_publicly / reminders_enabled. Save inline.
3. **Що я запропонував**: список своих submitted events со статусами.

---

### F. Miniapp propose `/m/propose`

AI-assisted event creation. Чат-like интерфейс внутри miniapp.

**Flow:**

1. Веteran пишет в textarea: "хочу зробити X в Y у Z на N людей". Tap `Далі`.
2. POST → `gemini-parse-event`. Loading state ≤3s.
3. Show parsed preview card (Show event-page layout с заполненными полями) + список clarifying_questions (если есть).
4. Если есть questions — для каждого: input + tap `Відповісти`. После ответа на все — re-parse.
5. Final state: `[Все вірно — на модерацію]` `[Виправити]`.
6. После submit: "На модерації. Зазвичай протягом доби. Скажу, як буде готово." + screenshot of submitted draft.

---

### G. Map view `/m/map`

Leaflet + OpenStreetMap. Маркеры — events. Цвет маркера зависит от: accessibility (зелёный = соответствует флагам ветерана; серый = не соответствует). Tap маркер → mini-card → tap card → `/m/event/[slug]`.

Filter chips сверху: `♿ безбар'єрно`, `жіночі групи`, `безкоштовно`, `сьогодні-завтра`.

---

### H. Organizer flow `/org/new-event`

Без чата. Простая форма: title, description, city/address, start_at + duration, categories (chips), identity (radio), accessibility (checkboxes), photo upload, contact, max_people, price.

Submit → `events` row с `status='pending'`.

После submit: "Ми перевіримо до 24 годин і повідомимо. Можеш слідкувати в /org/me".

---

### I. Admin inbox `/admin/inbox`

Single list, sorted by `ai_screen_score asc, created_at asc` (red flags на верх).

Каждая карточка:
- Title + city + start_at.
- AI score badge (зелёный/жёлтый/красный).
- Red flags as chips.
- `Відкрити →` → `/admin/event/[id]`.

---

### J. Admin event card `/admin/event/[id]`

Полное preview как ветеран увидит + admin sidebar справа:
- AI red flags + suggested edits (читаемо).
- Editable inline всех полей.
- Three buttons: `✅ Approve & Publish` `✏️ Save edits` `❌ Reject` (последняя — с обязательным reason).
- История действий (moderation_log).

После Approve: row `events.status='approved'`, `published_at=now()`. Пушим уведомление организатору.

---

### K. Admin analytics `/admin/analytics`

Один экран. Сверху — KPI tiles:
- Активних ветеранів (last 30 days).
- Подій опубліковано / на модерації.
- RSVPs за тиждень.
- Attended / no-show ratio.
- Топ міст за активністю.

Ниже — простая таблица событий с колонками title / city / RSVPs / attended / avg rating.

---

## Design system

### Палитра (light theme — primary, MVP)

```
/* warm calm, no military, no corporate-gray */
--bg:                     #FBF7F0;     /* warm cream */
--bg-elevated:            #FFFFFF;
--surface-soft:           #F4ECDD;
--text-primary:           #1F2A2E;     /* near-black, warm */
--text-secondary:         #5D6E72;
--text-muted:             #94A1A4;
--accent:                 #2B6E5A;     /* muted teal — calm, not military green */
--accent-soft:            #DDEEE7;     /* AI reason highlight bg */
--warning:                #C97B3F;     /* amber, friendly */
--danger:                 #B53A3A;     /* sparing, only for honest_absences */
--border:                 #E5DBC5;
--focus:                  #2B6E5A;     /* same as accent for clarity */
```

### Тип: `Inter` (variable). Жирность 400/500/600. Размеры:
- `display`: 24/30
- `h2`: 20/26
- `body`: 16/24
- `small`: 14/20
- `caption`: 12/16

### Радиусы: 12 (карточки), 8 (chips/buttons), 999 (avatars).

### Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48.

### Иконки

- Lucide-react base.
- Accessibility — кастомный set с подписями. См. `05_CLAUDE_DESIGN.md`.

### Components inventory (приоритет на MVP)

```
EventCard            (variant: featured | compact | mini)
AccessibilityStrip   (icons + labels)
WhoIsGoing           (count + optional names)
RsvpCta              (3 buttons: confirm, share, defer)
AiReasonChip         (single line, accent-soft bg)
SectionHeader
SocialProofLine
PersonaChip          (for testing — toggle persona on demo)
QrModal
CalendarLink
SharePanel
OnboardingCard       (one question per screen)
ChatTurn             (for propose flow)
AdminInboxRow
AdminEventEditor
ModerationActionBar
EmptyState
DeferToast
HonestAbsenceBadge
AccessibilityFilter
MapMarker            (variant: match | partial | nomatch)
```

### Telegram Mini App specifics

- Use `Telegram.WebApp.expand()` on mount.
- Use `Telegram.WebApp.MainButton` for primary CTA in flows where viewport space is critical (RSVP confirm, propose submit).
- Theme: respect Telegram's `themeParams` only at borders/dividers; don't try to invert our palette to dark mode at MVP. (Telegram users override allowed.)
- BackButton: enable for every screen except `/m/feed`.

---

## Acceptance criteria для frontend-агента

- [ ] Публичный event page открывается за <1s на 4G, Lighthouse mobile ≥90 (perf), accessibility ≥95.
- [ ] Все 4 персоны проходят свой walkthrough на seeded data без багов (см. `00_MASTER_BRIEF.md` § "Что считается успехом демо").
- [ ] Wife-mediated flow: открытие event-page без логина → tap Share → копия ссылки → открытие в чужом браузере → онбординг → RSVP. Под 3 минуты от A до Я.
- [ ] Onboarding: cold start ≤45 сек до первого AI-ranked feed.
- [ ] Onboarding: deep-link skip — 0 questions если в URL уже event_id, 1 question (display_name) при tap "Я буду".
- [ ] Admin может пройти полный moderation cycle на 5 seeded событиях за <10 мин.
- [ ] Все CTA имеют `aria-label`. Все формы доступны клавиатурой. Контраст 4.5:1.
