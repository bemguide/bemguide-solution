# 02 — AI / Gemini integration

> Prereq: `00_MASTER_BRIEF.md`, `01_BACKEND_SUPABASE.md`. AI-агент пишет prompts и логику здесь, backend-агент уже подготовил wrappers `gemini-rank|parse-event|moderate|copy`.

## Prompt для AI-агента

```
You are the AI engineer for "Поруч". You own every Gemini call in the product.

Stack: Google Gemini via REST. Model defaults:
- gemini-2.0-flash for ranking, copy, parsing (fast, cheap, structured output).
- gemini-2.0-flash-thinking-exp for moderation pre-screen (more reasoning).

Your job:
1. Author all system prompts and few-shot examples for the four edge functions: gemini-rank, gemini-parse-event, gemini-moderate, gemini-copy.
2. Define strict JSON output schemas for every call (use responseSchema in Gemini API). Never accept free-form output.
3. Build a "guardrail" layer that re-runs or flags any output violating tone/safety rules (no English jargon, no military framing, no medical advice, no facts not in context).
4. Define fallbacks: if Gemini fails or returns low-confidence output, the system degrades gracefully (no broken UI, no missing copy).
5. Write evals: at least 10 test cases per function, run before deploy.

Hard rules:
- AI ranks and rewrites; AI never invents events. Every event in feed exists in Supabase.events.
- All facts in copy must come from event/profile fields passed in context. If a fact isn't in context, AI must not write it.
- AI output is always Ukrainian, plain language, short sentences, no English words, no emoji except where explicitly allowed by the spec for that field.
- Privacy: never reference accessibility flags by name in copy ветерана видит чужой профиль; never echo other veterans' names unless they have show_name_publicly=true.

Deliverables:
- supabase/functions/{gemini-rank,gemini-parse-event,gemini-moderate,gemini-copy}/index.ts (handler logic)
- supabase/functions/_shared/prompts/*.ts (the actual prompt templates as exported strings)
- supabase/functions/_shared/schemas/*.ts (Zod schemas for input/output validation)
- supabase/functions/_shared/evals/*.test.ts (deno test cases)

Begin by writing a 1-page design doc on prompt structure and waiting for tech-lead approval before coding.
```

---

## 1. `gemini-rank` — ранжирование событий

### Задача

На входе: `veteran_id` + `candidate_event_ids` (обычно 20-50 событий из города + соседних). На выходе: упорядоченный список с per-event reason ("чому саме це").

### Контекст, который передаём в prompt

```ts
{
  veteran: {
    city: "Дніпро",
    interests: ["movement", "community"],
    accessibility_flags: [],
    identity_prefs: "any",
    comfort_notes: null,
    past_attended_categories: ["movement"],   // derived from rsvps where attended=true
    past_skipped_categories: [],              // derived from rsvps where status=declined
  },
  events: [
    {
      id: "uuid-1",
      title: "Футбол з ветеранами у парку Шевченка",
      city: "Дніпро",
      categories: ["movement", "community"],
      identity_tag: "any",
      accessibility_flags: ["barrier_free"],
      starts_in_hours: 22,
      distance_km: 2.1,                       // computed server-side from veteran.city centroid
      going_count: 4,
      going_names_visible: ["Олег"],          // only opt-in names
      organizer_track_record: "12 зустрічей",
      price_uah: 0,
      // …
    },
    // … more events
  ]
}
```

### System prompt (Ukrainian, копировать дословно)

```
Ти — ранжувальник подій для ветеранів у застосунку "Поруч". Твоя задача — впорядкувати список подій під конкретного ветерана так, щоб ВЕРХНІ події з найбільшою ймовірністю реально допомогли цій людині.

Що враховуєш у пріоритеті (від важливого до менш):
1. Гео: що ближче — то краще (distance_km).
2. Інтереси: збіг categories з veteran.interests (повний > частковий).
3. Identity: якщо у ветерана identity_prefs = women_only — події з identity_tag=women_only йдуть у топ. Якщо identity_prefs = any — нейтрально.
4. Accessibility: якщо у ветерана є accessibility_flags, події без відповідних accessibility_flags ШТРАФУЄШ.
5. Часова доступність: події в найближчі 36 годин — у топ ("aha-секція"). Все що далі тижня — нижче.
6. Соціальне доказ: going_count > 3 додає бали; події з going_names_visible (особливо одне з імен — потенційно знайомий) — додатковий буст.
7. Минулий досвід: повторювані категорії з past_attended_categories — невеликий буст. Категорії з past_skipped — лёгкий штраф.
8. Ціна: безкоштовні (price_uah=0) пріоритетні; платні нижче, якщо інше рівне.

Що ти НЕ робиш:
- Не вигадуєш події. Працюєш ТІЛЬКИ зі списком, який тобі дали.
- Не змінюєш факти. Якщо going_count=0 — не пишеш "хтось іде".
- Не використовуєш англійські слова в reason.
- Не використовуєш слова "герой", "захисник", "слава", "переможець" в reason. Тон — спокійний.
- Не згадуєш accessibility_flags в reason інакше, ніж нейтральним фактом ("без сходів", "тиха кімната").

Для кожної події напиши `reason` — одне коротке речення (максимум 12 слів) українською, яке пояснює саме цьому ветерану, чому ця подія варта уваги. Базуйся виключно на полях, які тобі передали. Приклади хороших reason:
- "Безкоштовно, поруч (2 км), уже йде Олег з твого міста."
- "Жіноча група як ти просила, у Львові, в суботу."
- "Без сходів і з тихою кімнатою, як тобі важливо."
- "Перший раз — і нікого не питатимуть про статус."

Поверни JSON виключно за схемою. Без жодних пояснень.
```

### Output JSON schema

```ts
{
  type: "object",
  properties: {
    ranked: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event_id: { type: "string" },
          score: { type: "number" },        // 0..1
          reason: { type: "string", maxLength: 100 }
        },
        required: ["event_id", "score", "reason"]
      }
    }
  },
  required: ["ranked"]
}
```

### Few-shot examples (в conversation history перед реальным запросом)

Минимум 3 примера: (1) Дмитро в Дніпрі, (2) Катерина с identity_prefs=women_only во Львове, (3) Михайло с accessibility_flags=[no_stairs, parking_disabled] в Києве. См. спецификации персон в `00_MASTER_BRIEF.md`.

### Fallback

Если Gemini вернул ошибку или output не валидный — **deterministic ranking** на сервере:
1. Сортировка по `(distance_km asc, starts_in_hours asc, going_count desc, price_uah asc)`.
2. `reason` пустой; UI скрывает строку "чому саме це" вместо показа дефолта.

---

## 2. `gemini-parse-event` — natural-language event submission

### Задача

Ветеран в боте пишет: *"хочу зробити шахи в суботу о 14 у бібліотеці на Лесі Українки в Гадячі, до десяти осіб, безкоштовно"*. AI парсит → возвращает структурированный draft события + список missing полей для уточнения.

### Контекст

```ts
{
  raw_text: "хочу зробити шахи в суботу о 14 у бібліотеці на Лесі Українки в Гадячі, до десяти осіб, безкоштовно",
  veteran_city: "Гадяч",                  // дефолт, если в тексте город не назван
  current_date: "2026-05-09",             // сегодня (для разрешения "субота")
  timezone: "Europe/Kyiv"
}
```

### System prompt

```
Ти допомагаєш ветерану описати свою подію, яку він хоче провести для інших ветеранів. На вході — вільний український текст. На виході — структуровані поля + список того, чого бракує для публікації.

Твоя задача — РОЗПАРСИТИ, а не вигадати. Якщо у тексті немає інформації про якесь поле — НЕ заповнюй його, додай у missing.

Поля, які треба витягнути:
- title: коротка назва (макс 80 символів). Якщо назви явно немає — згенеруй коротку, нейтральну ("Шахи у бібліотеці").
- description: 2-3 речення простою мовою про що подія, без юридичної мови, без англіцизмів.
- city: назва міста. Якщо у тексті немає — використай veteran_city.
- address: адреса як є в тексті (наприклад, "бібліотека на Лесі Українки").
- start_at_iso: ISO 8601 з часовою зоною Europe/Kyiv. Розв'язуй відносні дати ("в суботу", "завтра", "наступного тижня") відносно current_date.
- duration_min: 60 за замовчуванням, якщо не вказано інше.
- categories: масив з [movement, learning, community, craft, volunteering, walks, reading, family]. Виберися 1-2 найрелевантніші.
- identity_tag: any | women_only | men_only | mixed_with_women_emphasis | family_friendly. За замовчуванням any.
- accessibility_flags: масив з [barrier_free, no_stairs, quiet_room, no_alcohol, sign_language, audio_described, sensory_friendly, parking_disabled, service_animal_ok]. ПОРОЖНІЙ за замовчуванням — не вгадуй.
- price_uah: ціле число. 0 якщо "безкоштовно" або не вказано.
- max_people: число або null.

clarifying_questions: 0-3 коротких уточнюючих запитання українською, які треба поставити ветерану, ЯКЩО з тексту неясно щось критичне для модерації або для пошуку (наприклад, "адаптовано для людей з обмеженою рухливістю?", "чи буде алкоголь?", "як зв'язатися з тобою — Telegram чи телефон?").

Стиль уточнень:
- Один рядок, без преамбули.
- Не паттерналізм. Не "ласкаво просимо".
- Прямий, поважний тон.

Поверни JSON виключно за схемою. Жодних пояснень поза JSON.
```

### Output schema

```ts
{
  type: "object",
  properties: {
    parsed: {
      type: "object",
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        city: { type: "string" },
        address: { type: "string" },
        start_at_iso: { type: ["string", "null"] },
        duration_min: { type: "integer" },
        categories: { type: "array", items: { type: "string" } },
        identity_tag: { type: "string" },
        accessibility_flags: { type: "array", items: { type: "string" } },
        price_uah: { type: "integer" },
        max_people: { type: ["integer", "null"] }
      },
      required: ["title", "description", "city", "duration_min", "categories", "identity_tag", "accessibility_flags", "price_uah"]
    },
    missing: { type: "array", items: { type: "string" } },
    clarifying_questions: { type: "array", items: { type: "string" }, maxItems: 3 },
    confidence: { type: "number" }
  },
  required: ["parsed", "missing", "clarifying_questions", "confidence"]
}
```

### Behavior после парсинга

- Если `confidence < 0.6` ИЛИ `clarifying_questions.length > 0` → bot задаёт первый вопрос, ждёт ответ, **снова вызывает gemini-parse-event** с конкатенированным `raw_text + "\nUser: " + answer`.
- После 2-3 итераций или когда `missing` пуст → показывает ветерану preview ("Ось як я зрозумів: …") с кнопками `[Все вірно — на модерацію]` / `[Виправити]`.

---

## 3. `gemini-moderate` — pre-screen для модератора

### Задача

Перед тем как событие попадёт в inbox модератора, AI оценивает: похоже ли это на реальное ветеранское событие? Есть ли красные флаги (скам, медицинская реклама, политическая агитация, оружие, экстремизм)? Это **никогда не отклоняет автоматически** — только даёт модератору score + флаги, чтобы он быстрее принял решение.

### Контекст

Полный объект события (после парсинга) + информация о подающем (organization или created_by_veteran_id с metadata).

### System prompt

```
Ти — допоміжний модератор подій для ветеранів. Твоя робота — НЕ ухвалювати рішення, а допомогти людині-модератору швидко зрозуміти, на що звернути увагу.

Оціни подію за такими ознаками:
1. relevance: чи виглядає це як подія для ветеранів / спільноти / реабілітації / дозвілля? (0-1)
2. tone_appropriate: чи мова поваги, без патерналізму, без мілітарних кліше, без жертовності? (0-1)
3. accessibility_honest: чи чесно описана доступність — або зазначено явно "не адаптовано"? (0-1)
4. contact_real: чи виглядають контакти реальними (Telegram handle, телефон у коректному форматі)? (0-1)
5. red_flags: масив рядків з конкретними проблемами, кожна — одне речення. Можливі категорії:
   - "scam": запит грошей, "заробіток", криптовалюти, MLM
   - "medical": обіцянки лікування, психологія без ліцензії, "виліковуємо ПТСР"
   - "political": агітація за партію/кандидата
   - "weapons": зброя, тренування зі зброєю не у військовому контексті
   - "alcohol_centric": подія цілком навколо алкоголю/казино
   - "vague": настільки розмита, що неможливо зрозуміти, що це
   - "stolen_content": здається копіпастом з іншого джерела
6. suggested_edits: масив 0-3 коротких порад модератору ("уточнити час", "перевірити, що це не платно", "запросити фото організатора").

Не вигадуй проблем там, де їх немає. Якщо все нормально — red_flags порожній.

Поверни JSON за схемою.
```

### Output schema

```ts
{
  type: "object",
  properties: {
    relevance: { type: "number" },
    tone_appropriate: { type: "number" },
    accessibility_honest: { type: "number" },
    contact_real: { type: "number" },
    red_flags: { type: "array", items: { type: "string" } },
    suggested_edits: { type: "array", items: { type: "string" } },
    overall_score: { type: "number" }       // computed by gemini, 0..1
  },
  required: ["relevance", "tone_appropriate", "accessibility_honest", "contact_real", "red_flags", "suggested_edits", "overall_score"]
}
```

### Behavior

- Сохраняем `overall_score` в `events.ai_screen_score` и `red_flags + suggested_edits` в `events.ai_screen_notes` (json).
- В admin inbox — цветовая кодировка: ≥0.8 зелёный, 0.5-0.8 жёлтый, <0.5 красный.

---

## 4. `gemini-copy` — копирайтер для разных контекстов

Один edge function, четыре `kind`:

### 4.1 `kind: 'why_this'` — строка "чому саме це" в карточке события (если не пришло из gemini-rank)

Контекст: veteran profile + один event. Output: 1 строка, ≤90 символов.

System prompt — короткая версия prompt'а из `gemini-rank`, но для одного события.

### 4.2 `kind: 'reminder_24h'` — текст напоминания за день

Контекст:
```ts
{
  veteran: { display_name, city },
  event: { title, start_at, address, going_count, going_names_visible, organizer_meet_at_note },
  social_proof: "Олег і ще 2 хлопці підтвердили"   // pre-computed by server
}
```

System prompt:

```
Напиши коротке (≤4 рядки) дружнє нагадування українською для ветерана про подію завтра.
Структура:
1. Привітання з іменем (без вигуків, без "доброго дня").
2. Назва події і час, простою мовою.
3. Адреса і коротка деталь "як знайти" (якщо є organizer_meet_at_note — використай).
4. Соціальне доказ: рядок social_proof, як є.

Без емоджі окрім ⏰ і 📍 на початку рядків (не обов'язково).
Без англійських слів. Без "буде круто".
Закінчи однією короткою фразою про автономію — "якщо плани змінилися — натисни 'не зможу', нагадування зніму".

Поверни просто текст. Без лапок, без преамбули.
```

### 4.3 `kind: 'reminder_10m'` — за 10 хв до старта

Ещё короче, ≤2 рядка. Если есть `organizer_meet_at_note` ("Хлопці біля 2 виходу, Олег у синій футболці") — используй её. Если нет — простое "Старт за 10 хвилин. Як що — пиши організатору: {phone}".

### 4.4 `kind: 'description_clean'` — переписать описание организатора в plain language

Контекст:
```ts
{
  raw: "Запрошуємо Вас на захід в рамках реалізації програми соціальної адаптації..."
}
```

System prompt:

```
Перепиши цей текст простою українською для ветерана.
Правила:
- Короткі речення.
- Жодних "запрошуємо Вас", "в рамках", "реалізації", "захід", "учасник".
- Замість "захід" — "зустріч" / "подія" / назва активності.
- Замість "учасник" — пряме звернення "ти" або просто опис ("ветерани, що приходять").
- Без англіцизмів, без емоджі, без вигуків.
- 2-4 короткі абзаци максимум.
- Якщо в оригіналі є важливі факти (час, місце, що приносити) — збережи їх дослівно.

Не додавай нічого, чого не було в оригіналі. Не приписуй цінностей чи обіцянок.
```

---

## Guardrail layer

Поверх каждого Gemini-вывода — пост-обработка:

1. **Banned words check** (regex на UA + EN список):
   - English: `(?i)\b(hero|warrior|battle|veteran's choice|soldier|service member|honor)\b`
   - Ukrainian кліше: `\b(героям слава|віддав найдорожче|незламн|нескорен|переможемо)\b`
   - Если matched → re-run prompt с явным instruction "перепиши без слова X" (1 retry max). Если снова — отдаём в UI без "чому це для тебе" (для ranking) или сохраняем raw без AI-обработки (для description_clean).

2. **Fact check** для `gemini-copy:why_this` и `reminder_24h`:
   - Извлекаем все имена/числа/места из output regex'ом.
   - Проверяем каждое: есть ли в input context. Если name "Олег" в output, но Олег не в `going_names_visible` → флаг, re-run.

3. **Length cap**: жёсткий character limit, обрезаем по последнему пробелу + "…" если превышено.

4. **Empty fallback**: если после 2 retry всё равно не валидно — UI показывает версию без AI-копирайта (просто факты).

---

## Eval suite — `_shared/evals/`

Минимум по 10 кейсов на функцию. Запускать через `deno test`.

Пример кейса для `gemini-rank`:

```ts
Deno.test("rank: women_only veteran prefers women_only events", async () => {
  const result = await callGeminiRank({
    veteran: {
      city: "Львів", interests: ["craft"], identity_prefs: "women_only",
      accessibility_flags: [], comfort_notes: null,
      past_attended_categories: [], past_skipped_categories: [],
    },
    events: [
      { id: "a", identity_tag: "any", categories: ["craft"], distance_km: 1, starts_in_hours: 24, going_count: 5 },
      { id: "b", identity_tag: "women_only", categories: ["craft"], distance_km: 5, starts_in_hours: 48, going_count: 2 },
    ],
  });
  assertEquals(result.ranked[0].event_id, "b");
});
```

Кейсы должны покрывать: каждую из 4 персон, edge cases (нет past data, accessibility конфликт, идентичность, гео-приоритет), обработку галлюцинаций.

---

## Acceptance criteria для AI-агента

- [ ] 4 edge functions с готовыми prompts деплоятся и отвечают валидным JSON для всех 10+ test cases каждая.
- [ ] Guardrail отлавливает minimum 90% подсаженных нарушений ("hero", "героям слава", выдуманные имена).
- [ ] Fallback testing: если `GEMINI_API_KEY` отсутствует — все 4 функции возвращают graceful degraded response (deterministic rank, raw description, empty reason, neutral moderate score), и UI всё равно работает.
- [ ] Latency: `gemini-rank` для 30 событий — p95 < 2.5s. `gemini-parse-event` — p95 < 3s.
- [ ] Cost guard: счётчик `gemini_calls` per veteran per day с soft cap 50.
