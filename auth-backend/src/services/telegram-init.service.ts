import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

// Verify Telegram WebApp initData per the official spec:
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Algorithm:
//   1. Parse the URL-encoded query string into key/value pairs.
//   2. Pull `hash` aside — it's the HMAC the client claims is valid.
//   3. Build data_check_string = entries sorted by key, joined as "key=value\n".
//   4. secret_key = HMAC-SHA256(key="WebAppData", message=BOT_TOKEN).
//   5. expected_hash = HMAC-SHA256(key=secret_key, message=data_check_string).
//   6. Constant-time compare expected_hash with the claimed `hash`.

export interface TelegramInitDataUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export interface VerifiedInitData {
  user: TelegramInitDataUser;
  auth_date: number; // unix seconds
  query_id?: string;
}

export function verifyInitData(initData: string): VerifiedInitData {
  if (!env.TELEGRAM_BOT_TOKEN) {
    // We can't verify without the bot token — fail loud rather than silently
    // accepting any client claim.
    throw AppError.internal('TELEGRAM_BOT_TOKEN not configured');
  }

  // URLSearchParams handles percent-decoding the same way Telegram URL-encodes.
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData missing hash',
      statusCode: 400,
    });
  }
  params.delete('hash');

  // Sort keys lexicographically and join "key=value" with \n.
  const entries: [string, string][] = [];
  params.forEach((value, key) => entries.push([key, value]));
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  const expected = createHmac('sha256', secretKey).update(dataCheckString).digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(hash, 'hex');
  } catch {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData hash is not hex',
      statusCode: 400,
    });
  }
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData signature mismatch',
      statusCode: 400,
    });
  }

  // Auth date freshness — reject anything older than the configured window.
  const authDateRaw = params.get('auth_date');
  if (!authDateRaw) {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData missing auth_date',
      statusCode: 400,
    });
  }
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData auth_date is not numeric',
      statusCode: 400,
    });
  }
  const ageSeconds = Math.floor(Date.now() / 1000) - authDate;
  if (ageSeconds > env.TELEGRAM_INIT_DATA_MAX_AGE_SECONDS) {
    throw new AppError({
      code: 'expired_init_data',
      message: 'initData expired',
      statusCode: 401,
    });
  }

  // The user blob is JSON-encoded inside one of the query params.
  const userRaw = params.get('user');
  if (!userRaw) {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData missing user',
      statusCode: 400,
    });
  }
  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userRaw) as TelegramInitDataUser;
  } catch {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData user is not JSON',
      statusCode: 400,
    });
  }
  if (typeof user?.id !== 'number') {
    throw new AppError({
      code: 'invalid_init_data',
      message: 'initData user.id missing',
      statusCode: 400,
    });
  }

  return {
    user,
    auth_date: authDate,
    query_id: params.get('query_id') ?? undefined,
  };
}
