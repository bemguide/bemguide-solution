# 04 — Telegram Bot

> Prereq: `00_MASTER_BRIEF.md`, `01_BACKEND_SUPABASE.md`. Bot — точка входа для большинства ветеранов и для организаторов. Он же доставляет напоминания и post-event survey.

## Prompt для bot-агента

```
You are the Telegram bot engineer for "Поруч". The bot lives at @poruch_bot (или @poruch_test_bot для разработки).

Stack: grammY (Deno) running as a Supabase Edge Function (functions/bot/index.ts) behind a webhook.

The bot has THREE modes detected by start parameter or by user role:
1. Veteran mode (default) — onboarding, browse, RSVP, propose events, receive reminders.
2. Organizer mode (start param "org") — register заведення, submit events.
3. Admin mode is web-only; bot does not have admin commands.

The Mini App is the primary surface for browsing and RSVP. The bot's job is:
- Get the user into the Mini App at the right context (deep linking).
- Handle conversational flows that don't fit a UI: NL event proposal, post-event survey, deferred reminders.
- Send all notifications (RSVP confirm, T-24h, T-10min, T+24h survey).
- Collect feedback that can't easily be a button press (peer quote text).

Hard rules:
- Never wall the user. Every multi-step bot flow has `/cancel` and a literal "Скасувати" button.
- Default reply tone: short, plain Ukrainian, no exclamation marks, no emoji except где explicitly allowed.
- ANY message that proposes an action with consequences (RSVP, submit event, change settings) → require explicit confirmation tap, not "type yes".
- All text — Ukrainian. No transliteration of English words.
- The bot remembers state via Supabase tables (no in-memory session that breaks on cold start).

Begin with a 1-page state diagram + command list, wait for tech-lead approval.
```

---

## Команды

| Command | Audience | Behavior |
|---|---|---|
| `/start` | all | Welcome → CTA "Відкрити Поруч" (launches Mini App at /m/feed or /m/event/[slug] if start param matches) |
| `/start evt_<id>` | all | Deep link to event. Open Mini App at /m/event/[slug]. |
| `/start defer_<id>` | all | Marks RSVP as deferred via API; bot replies "Окей, нагадаю через тиждень". |
| `/start org` | organizers | Sets ctx.is_organizer=true; offers `/neweventform` или Mini App link. |
| `/me` | veterans | Quick summary: city, X upcoming events, link "Налаштування → Mini App". |
| `/skip` | all | Skips current bot question in any flow. |
| `/cancel` | all | Cancels current flow, returns to neutral. |
| `/help` | all | "Що я вмію" — короткий список. |
| `/feedback` | all | Открывает диалог: "Напиши, що думаєш про Поруч". Сохраняем в Supabase notifications таблицу с type=broadcast (для команды). |
| `/contact` | all | "Якщо щось не так — пиши: @{moderator_handle}" |
| `/stop_reminders` | veterans | Toggle reminders_enabled=false. Confirm + revert link. |

Команды organizer'а (только если `is_organizer=true`):
| `/myevents` | список своих событий со статусами |
| `/newevent` | старт structured form (см. flow ниже) |

---

## State machine для ветерана

```
NEW
 ↓ /start (no param)
WELCOME — sends:
  Photo + caption: "Поруч — щоб поряд були люди і події, без зайвих питань."
  Inline keyboard:
    [ Відкрити Поруч ]  → web_app: PUBLIC_BASE_URL/m/onboarding
    [ Що це? ]          → callback "intro"
 ↓ user opens miniapp → onboarding handled in web
ACTIVE — bot is silent until:
  - notifications fire (T-24h, T-10min, T+24h)
  - user replies to our message
  - user types /command
```

```
NEW
 ↓ /start evt_abc123
DEEP_LINK_EVENT — sends:
  Inline keyboard:
    [ Відкрити подію ] → web_app: PUBLIC_BASE_URL/m/event/<slug>
    [ Не зараз ]        → callback "defer_abc123"
 ↓ user taps "Відкрити подію" → handled in miniapp
```

---

## Flow: NL event proposal (alternative to Mini App propose)

Запускается через `/newevent` или из Mini App ("/m/propose") если ветеран предпочитает текст в чате.

```
BOT: "Опиши коротко, яку подію хочеш провести. Що, де, коли, для кого. Можна одним повідомленням."
USER: "хочу зробити шахи в суботу 14:00 у Гадячі, бібліотека на Лесі Українки, до 10 людей"

BOT: [calls gemini-parse-event] → loading "Хвилинку, читаю…"
BOT: [parsed event card preview as text]
     "Як я зрозумів:
       • Шахи у бібліотеці
       • Гадяч, бібліотека на Лесі Українки
       • Субота, 16 травня, 14:00 (1 година)
       • До 10 людей
       • Безкоштовно
      
      Кілька уточнень:
      1. Адаптовано для людей з обмеженою рухливістю?"
     Inline buttons: [ Так ] [ Частково ] [ Ні ] [ Не знаю ]

USER: tap [Частково]

BOT: "2. Як з тобою зв'язатися — Telegram чи телефон?"
     (text input expected)

USER: "@dmytro_kp"

BOT: [re-parse with combined context]
     "Готово. Ось як виглядатиме картка для інших ветеранів:
      [event preview]
      
      Все вірно?"
     Inline: [ ✅ Подаю на модерацію ] [ ✏️ Виправити ]

USER: tap [ ✅ Подаю на модерацію ]

BOT: "Подав. Зазвичай модерація — до 24 годин. Скажу, як буде готово."
     [event row inserted with status='pending']
```

State хранится в `bot_sessions` table (не в memory):
```sql
create table bot_sessions (
  user_id bigint primary key,
  flow text not null,           -- 'propose_event' | 'org_register' | etc.
  step integer not null,
  payload jsonb not null,
  updated_at timestamptz not null default now()
);
```

---

## Flow: Post-event survey

Триггер: cron `enqueue-post-event-surveys` создаёт notification с `type='post_event'`, `scheduled_for=event.end + 24h`.

```
BOT: "Як було на 'Шахи у бібліотеці', субота?"
     Inline: [ 👍 нормально ] [ 😐 так собі ] [ 👎 не пішло ]

USER: tap [👍]

BOT: [insert ratings row with score='up']
     "Дякую. Якщо хочеш — одне речення для інших ветеранів, які думають піти. Можна пропустити."
     Inline: [ Пропустити ]
     (text input also accepted)

USER: "нормально, навіть з протезом грав, ніхто не дивився"

BOT: [updates ratings.peer_quote, peer_quote_approved=false (waits for moderator)]
     "Передам. Покажу твій відгук іншим, тільки якщо все добре по тону. Дякую."
```

Если ветеран не отвечает 7 дней — notification archives, no nag.

---

## Notification templates (Ukrainian)

> Бот рендерит ровно эти шаблоны. AI-персонализированная строка приходит из `gemini-copy` (опционально, fallback — без неё).

### `rsvp_confirm`

```
Записав на «{title}», {pretty_date} о {pretty_time}.

📍 {address}
{distance_line if available}

Нагадаю напередодні ввечері і за 10 хвилин до старту.
Якщо плани зміняться — натисни «Не зможу», нагадування зніму.
```

Inline keyboard:
```
[ 📅 Додати в календар ] (deep link to ICS)
[ 📷 Мій QR ] (callback → sends photo with QR)
[ 📍 Як дістатися ] (text url to maps)
[ ❌ Не зможу ] (callback → cancel rsvp + confirm)
```

### `reminder_24h`

```
Завтра {pretty_time} — «{title}».
{address}.

{social_proof_line — from gemini-copy or pre-computed}

Якщо плани зміняться — «Не зможу».
```

### `reminder_10m`

```
Старт за 10 хвилин — «{title}».
{meet_at_note if available}
```

### `post_event` — см. flow выше.

### `event_published` (для организаторов)

```
Твоя подія «{title}» опублікована.
Подивитися: {public_url}
Поділитися можна одним натиском.
```

### `moderation_decision` (для ветерана-автора события)

```
Approved:
  Твоя подія «{title}» опублікована. Дякую, що додав. Подивитися: {public_url}

Edited:
  Твоя подія «{title}» вийшла, з невеликими правками від модератора:
  {diff_summary}
  Подивитися: {public_url}

Rejected:
  Твоя подія «{title}» наразі не може бути опублікована. Причина:
  {reason}
  Можеш переробити і подати знов через /newevent.
```

---

## Mini App launch helper

В каждом сообщении, где open Mini App имеет смысл, кнопка типа `web_app`:

```ts
{
  text: "Відкрити Поруч",
  web_app: { url: `${PUBLIC_BASE_URL}/m/feed?start=${context}` }
}
```

start-параметр в URL фронт парсит и решает, куда открыть.

---

## initData verification (на edge function стороне)

Любая мутация из miniapp → отправляет header `X-Telegram-InitData: <raw initData>`. Edge function:
1. Parses key-value pairs.
2. Computes HMAC-SHA-256 by spec (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app).
3. Verifies signature against TG_BOT_TOKEN.
4. Verifies `auth_date` is within last 24h.
5. Extracts `user.id` → используем как ключ для veterans.tg_user_id.

Если verify fails — 401, никаких операций.

---

## Acceptance criteria для bot-агента

- [ ] Полный happy path: `/start` → Mini App link → onboarding → feed → tap "Я буду" → bot DM с `rsvp_confirm` (через notification scheduler) → user tap "Не зможу" → cancel + confirm.
- [ ] NL propose flow: parse → 1-2 уточнения → preview → submit. Конец-в-конец на seeded Gemini.
- [ ] Cron `notify-scheduler` отправляет 5 dispatched notifications за 1 минуту в test mode (mock TG API ok).
- [ ] `/cancel` корректно сбрасывает любой flow.
- [ ] HMAC verify тесты: 3 валидных + 3 атак (просрочен auth_date, изменён hash, missing field) — все отрабатывают корректно.
