# Поруч — Demo script

Click-by-click for the stage demo. Target time: **≤8 minutes for all 4 personas**.

Have these tabs open in advance:

1. Telegram desktop client, sign in to the demo account.
2. The bot DM with [@bembembem_testbot](https://t.me/bembembem_testbot) (clear chat history right before recording).
3. A second Telegram account (mobile or desktop) for the wife-mediated flow.
4. A regular browser pointed at `${NEXT_PUBLIC_APP_URL}/admin/inbox` (you'll log in once at the start).
5. The Supabase dashboard → Database → Tables → `events` and `notifications` (for the screen-share moment when you say "look — the row landed").

If a step needs a fresh seed, run `pnpm seed` from the repo root before the rehearsal.
Re-running the seed wipes prior demo RSVPs and ghost rows, then rebuilds with the same deterministic shuffle.

---

## 1. Дмитро — full happy path (≤2 min)

**Persona:** 33, contractor, 5 months home. Looking for low-friction local activity. Already on Telegram.

| #   | Action                                                                                                  | What to say                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | Open `@bembembem_testbot` → tap **/start**                                                              | "Дмитро відкриває бот. Жодних анкет, жодних обіцянок."                                                          |
| 2   | Tap **Відкрити Поруч**                                                                                  | "Mini App відкривається прямо в Telegram."                                                                      |
| 3   | Onboarding: pick **Київ** → tap **рух** + **спільнота** → **Готово**                                    | "Три питання, можна пропустити будь-яке."                                                                       |
| 4   | Land on **/m/feed**: top card "Сьогодні і завтра поруч"                                                 | "Ось — футбол з ветеранами завтра, 2 км. Дивись на бейдж — `Поруч, безкоштовно, тут уже є Олег з твого міста`." |
| 5   | Tap the football card                                                                                   | "Картка події. Чесна доступність — без сходів. 6 ветеранів іде, 4 з них поділилися іменами."                    |
| 6   | Tap **Я буду**                                                                                          | "Один тап. Imя ми вже маємо з Telegram."                                                                        |
| 7   | Confirm modal opens; tap **Готово**                                                                     | "Записав. Календар, QR, як дістатися — поруч. Пере‑тоглить ім'я можна тут же."                                  |
| 8   | Switch to bot DM tab                                                                                    | "Через 2 секунди — підтвердження в боті. Те, що говорить бот, той же тон що і застосунок."                      |
| 9   | Show the message: «Записав на «Футбол…» — кнопки [Додати в календар] [Мій QR] [Як дістатися] [Не зможу] | "Усе під рукою. «Не зможу» — один тап і нагадування знімаю."                                                    |
| 10  | (Optional) Tap **❌ Не зможу** to demonstrate cancel; show the bot edits its own message                | "Жодних звинувачень. Просто зник нагадування."                                                                  |

Show timer: from `/start` to bot confirmation should land in ≈45 seconds.

---

## 2. Катерина — identity-aware filter (≤90s)

**Persona:** 27, демобілізована медик ЗСУ. Не впевнена «чи я взагалі ветеранка». Дивиться через жіночу спільноту в Instagram.

| #   | Action                                                                                 | What to say                                                                                                                        |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Mini App, swap the city to **Львів** in `/m/me` settings (or open with second account) | "Катерина у Львові, identity_prefs = `women_only`."                                                                                |
| 2   | Open **/m/onboarding**, second screen, tap **жіночі групи**                            | "Ця опція — first-class. Не глибоко закопаний фільтр, перший вибір."                                                               |
| 3   | Open `/m/feed`                                                                         | "Перші три картки — жіночі групи. Не «корисний контент для жінок-ветеранів» — а «жіноча група як ти просила, у Львові, в суботу»." |
| 4   | Tap the **«Жіноче ремесло — гончарство і кави»** card                                  | "Обережний тон. Веде Оксана — ветеранка. Тиха кімната є."                                                                          |
| 5   | Show the AI reason chip                                                                | "Ось транспарентність — ⓘ показує, які поля профілю використано."                                                                  |

Leave without RSVP — just demonstrating the ranking.

---

## 3. Михайло — wife-mediated, public-page entry (≤2 min)

**Persona:** 46, ампутація, носить протез. Дружина шерить посилання у Viber.

| #   | Action                                                                                 | What to say                                                                                                                                                                  |
| --- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Browser tab, open `${NEXT_PUBLIC_APP_URL}/event/adaptyvne-plavannia-khvylya`           | "Жодного логіну. Якщо дружина шеритне посилання у Viber — ось що Михайло побачить, навіть не маючи Telegram налаштованого."                                                  |
| 2   | Highlight: hero, accessibility strip, **«роздягальня без лежака»** as a red-muted chip | "Ми чесно пишемо, чого НЕМАЄ. Михайло знає до того, як приїде."                                                                                                              |
| 3   | Show the «12 ветеранів іде» counter and Світлана-tренерка note                         | "Соціальне доказ. Світлана сама ходить з протезом — це сказано в описі."                                                                                                     |
| 4   | Tap **Поділитися**                                                                     | "Web Share API. Якщо браузер не підтримує — копіює посилання."                                                                                                               |
| 5   | Tap **Я буду**                                                                         | "Відкриває бот з deep link `?start=evt_<slug>`. Якщо Михайло вже в боті — одразу мініапп на цій події. Якщо ні — `/start` зведе його у профіль за 30 секунд і поверне сюди." |
| 6   | Tap **Не зараз — нагадай через тиждень** to show the deferral path                     | "Anti-paternalism — не змушуємо тут і зараз."                                                                                                                                |

---

## 4. Василь — NL proposal → moderation → publish (≤2 min)

**Persona:** 52, райцентр Полтавщина. Не любить форми. Хоче провести шахи у бібліотеці.

| #   | Action                                                                                                                         | What to say                                                                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------- |
| 1   | Bot DM, type **/newevent**                                                                                                     | "Василь не хоче форму. Він пише як говорить."                                                           |
| 2   | Bot replies + opens Mini App propose form                                                                                      | "Mini App відкриває chat-style вікно."                                                                  |
| 3   | Type into the textarea: `хочу зробити шахи в суботу 14 у Гадячі, бібліотека на Лесі Українки, до 10 людей, безкоштовно` → Send | "Природній текст. Без меню, без обовязкових полів."                                                     |
| 4   | Bot bubble: parsed preview block + clarifying question (e.g. «Адаптовано для людей з обмеженою рухливістю?»)                   | "Gemini розпарсив. Одне уточнення — про доступність."                                                   |
| 5   | Reply: `так, але ліфта немає`                                                                                                  | "Чесна відповідь. AI враховує її в наступному раунді."                                                  |
| 6   | Bot now shows the final preview card with **[Подаю на модерацію]**                                                             | "Ось як інші ветерани побачать це. Все вірно."                                                          |
| 7   | Tap **✅ Подаю на модерацію**                                                                                                  | "Сабміт. Пише «На модерації, до доби»."                                                                 |
| 8   | Switch to admin tab → `/admin/inbox`                                                                                           | "Модератор у вікні. Колір бейджа — це AI pre-screen score. Тут зелений — все нормально."                |
| 9   | Tap the new card                                                                                                               | "Той самий preview, як ветеран побачить. Праворуч — AI checks: relevance, тон, accessibility, контакт." |
| 10  | Tap **Approve & Publish**                                                                                                      | "Один клік. Подія в лайві. Васильові прийшов TG-меседж «опубліковано»."                                 |
| 11  | Switch back to bot DM                                                                                                          | "Подивися — повідомлення «Твоя подія…»"                                                                 |

Total time budget: ~7m30s with screen switches. Aim for 2m + 1m30s + 2m + 2m.

---

## Recovery plays (if something goes sideways live)

- **Gemini timeout / 429.** The feed falls back to deterministic ranking (`distance, hours, going_count, price`). Reasons disappear, but the layout is identical. Mention: "Тут AI зараз пробуксував — ми передбачили це: feed усе ще ранжує, просто без рядка «чому саме це»."
- **Notification doesn't arrive.** Open the admin → moderation card and click **«Send pending now»** (or run `pnpm exec tsx scripts/verify-functions.ts` from the repo and POST to `/notify-scheduler`).
- **Public event page returns 500.** Almost always a missing env var on the dev server. `tail -20 /tmp/dev.log` then restart `pnpm dev`.
- **Webhook desync.** `pnpm tg:webhook:info` shows the registered URL. `pnpm tg:webhook:set` re-registers.

---

## Pre-rehearsal checklist (run 30 min before the demo)

```
pnpm install
pnpm seed                 # rebuilds 30 events, 7 orgs, 119 ghost RSVPs deterministically
pnpm fn:deploy            # all 8 edge functions
pnpm tg:webhook:set       # webhook → live URL
pnpm dev                  # local dev (or `vercel deploy --prod`)
pnpm fn:verify            # 8/8 reachable
pnpm evals                # 16/16 against live Gemini
```

Have these screens ready in the slide deck:

- The accessibility strip with a `❌ роздягальня без лежака` chip — anchor for the «honest absences» line.
- The bot rsvp_confirm message with all four buttons.
- The admin moderation card with green/amber/red AI badges.
