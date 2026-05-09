// Dev helper: synthesize a valid Telegram initData payload signed with our
// TELEGRAM_BOT_TOKEN, exchange it at /auth/telegram, and print the bearer
// token. Used for ad-hoc curl testing without a real Mini App in the loop.
//
// Usage:
//   npm run dev:token                         # tg id 999000001, name "DevUser", base http://localhost:8080
//   API_BASE=https://...up.railway.app npm run dev:token
//   TG_ID=42 TG_NAME=Дмитро npm run dev:token
//   npm run dev:token -- --raw                # only print init_data (don't call /auth/telegram)
//
// SECURITY: this only works because we hold TELEGRAM_BOT_TOKEN in .env. With a
// real bot token, anyone can mint Mini-App auth for any TG id — that's why the
// bot token is a secret. Don't ship this script's output to a chat / log.

import 'dotenv/config';
import { createHmac } from 'node:crypto';

const args = new Set(process.argv.slice(2));
const onlyRaw = args.has('--raw');

const botToken = process.env.TELEGRAM_BOT_TOKEN;
if (!botToken) {
  console.error('TELEGRAM_BOT_TOKEN not set — run from auth-backend/ with .env present.');
  process.exit(1);
}

const tgId = Number(process.env.TG_ID ?? 999000001);
const tgName = process.env.TG_NAME ?? 'DevUser';
const apiBase = process.env.API_BASE ?? 'http://localhost:8080';

function makeInitData(): string {
  const authDate = Math.floor(Date.now() / 1000);
  const userPayload = JSON.stringify({ id: tgId, first_name: tgName });
  const params: Record<string, string> = {
    auth_date: String(authDate),
    user: userPayload,
  };

  // Algorithm per https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken!).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.set(k, v);
  usp.set('hash', hash);
  return usp.toString();
}

async function main(): Promise<void> {
  const initData = makeInitData();

  if (onlyRaw) {
    process.stdout.write(initData + '\n');
    return;
  }

  const res = await fetch(`${apiBase}/auth/telegram`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ init_data: initData }),
  });

  const body = (await res.json()) as Record<string, unknown>;
  if (!res.ok) {
    console.error(`POST /auth/telegram → ${res.status}:`, JSON.stringify(body, null, 2));
    process.exit(1);
  }

  const token = body.token as string;
  const user = body.user as { id: string; email: string };

  // Two-line output: the token alone (so you can `eval $(... | head -1)`) plus
  // a human-readable line for context.
  process.stdout.write(`${token}\n`);
  process.stderr.write(`# user.id=${user.id} email=${user.email} expires_at=${body.expires_at}\n`);
}

await main();
