# Make invitation messages tappable

## Problem

The dispatch worker currently sends:

```
Тебе запрошено: Народний хор ветеранів у Дніпрі

Відповісти можна тут (id: 4d3b34f5-efa5-4c93-8795-c566a7f8ae3e)
```

`id: <uuid>` is dead text. Tapping it does nothing. The user can't get
to the event from inside Telegram without leaving the chat.

## Required change

Replace the bare invitation-id with a Mini App deep link. The
frontend's `/` route already converts `start_param=evt_<event_id>`
into a redirect to `/m/event/<event_id>`, so the recipient lands on
the in-app event view (RSVP, attendees, QR check-in) with one tap.

**Format:**

```
Тебе запрошено: <title>

https://t.me/<bot_username>?startapp=evt_<event_id>
```

(Telegram auto-detects bare URLs and renders them as tappable links —
no `parse_mode` change needed. `disable_web_page_preview: true` is
already set on `sendMessage`, which is fine.)

## File to change

`auth-backend/src/workers/dispatch-invitations.ts`

## Diff

```diff
@@ delivery loop @@
-      const text = inviteText(inv.opportunities?.title ?? 'Подія', inv.id);
+      const text = inviteText(
+        inv.opportunities?.title ?? 'Подія',
+        inv.event_id,
+      );
       const result = await sendMessage(user.telegram_user_id, text);

@@ helper @@
-function inviteText(title: string, invitationId: string): string {
-  // The bot owns the response UX; this is the cold-start message.
-  return `Тебе запрошено: ${title}\n\nВідповісти можна тут (id: ${invitationId})`;
-}
+function inviteText(title: string, eventId: string): string {
+  // Deep link → frontend's / route bypass → /m/event/<id>.
+  // env.TELEGRAM_BOT_USERNAME is the same value already used in
+  // backend.API.md examples.
+  const link = env.TELEGRAM_BOT_USERNAME
+    ? `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=evt_${eventId}`
+    : '';
+  return link
+    ? `Тебе запрошено: ${title}\n\n${link}`
+    : `Тебе запрошено: ${title}`;
+}
```

`inv.event_id` already exists on the row (it's an
`event_invitations` column). The `inv.id` we used to pass was the
invitation row's PK — not useful for the recipient.

## Optional: inline keyboard

If you want the link to render as a button instead of a URL, switch
`sendMessage` to call `sendMessage` with `reply_markup`:

```ts
await callBotApi<SentMessage>('sendMessage', {
  chat_id,
  text: `Тебе запрошено: ${title}`,
  disable_web_page_preview: true,
  reply_markup: {
    inline_keyboard: [
      [
        {
          text: 'Відкрити подію',
          url: `https://t.me/${env.TELEGRAM_BOT_USERNAME}?startapp=evt_${eventId}`,
        },
      ],
    ],
  },
});
```

This requires extending the `sendMessage` wrapper to accept an
optional `reply_markup` argument.

## Test plan

1. Run the dispatch worker against a test invitation:
   `npm run worker:dispatch`
2. Open the chat in Telegram on a phone.
3. Tap the link.
4. Expect: Telegram opens the bot, the Mini App launches at
   `/m/event/<event_id>`, RSVP CTA / attending state is shown.
5. Repeat from a desktop — the deep link should still launch the
   WebApp panel into the right page.

## Frontend reference

Frontend already produces the same URL format from the share button
on `/m/event/[id]`:

`apps/web/lib/share.ts` → `buildEventShareUrl(eventId)`

So the message format and the share format are identical, which is
the point — recipients of either land in the same place.
