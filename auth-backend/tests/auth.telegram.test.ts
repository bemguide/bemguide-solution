import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { HAS_REAL_SERVICE_ROLE, deleteUserByEmail } from './helpers/supabase-test.js';
import { supabaseAdmin } from '../src/config/supabase.js';
import { env } from '../src/config/env.js';

// Synthesize a valid initData payload signed with our bot token, exactly as
// Telegram's WebApp.initData spec does:
//   secret_key = HMAC-SHA256("WebAppData", BOT_TOKEN)
//   hash       = HMAC-SHA256(secret_key, sorted "key=value\n" entries)
function makeInitData(opts: {
  telegramUserId: number;
  firstName?: string;
  authDateUnix?: number;
}): string {
  const authDate = opts.authDateUnix ?? Math.floor(Date.now() / 1000);
  const userPayload = JSON.stringify({
    id: opts.telegramUserId,
    first_name: opts.firstName ?? 'Test',
  });
  const params: Record<string, string> = {
    auth_date: String(authDate),
    user: userPayload,
  };
  const dataCheckString = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(env.TELEGRAM_BOT_TOKEN).digest();
  const hash = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  // initData is URL-encoded x-www-form-urlencoded.
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) usp.set(k, v);
  usp.set('hash', hash);
  return usp.toString();
}

const HAS_BOT_TOKEN = Boolean(env.TELEGRAM_BOT_TOKEN);
const describeIfReal = HAS_REAL_SERVICE_ROLE && HAS_BOT_TOKEN ? describe : describe.skip;

describeIfReal('POST /auth/telegram', () => {
  let app: FastifyInstance;
  const cleanupTelegramIds: number[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    // Each test creates a synthetic user; clean up the auth.users + public.users rows.
    for (const tgId of cleanupTelegramIds) {
      const email = `tg-${tgId}@poruch.local`;
      await deleteUserByEmail(email).catch(() => {});
    }
    await app.close();
  });

  it('verifies initData, creates user, returns token + V2User', async () => {
    // Random TG ID per run to avoid colliding across reruns within the cleanup window.
    const telegramUserId = 9_000_000_000 + Math.floor(Math.random() * 1_000_000);
    cleanupTelegramIds.push(telegramUserId);

    const initData = makeInitData({ telegramUserId, firstName: 'Дмитро' });
    const res = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      headers: { 'content-type': 'application/json' },
      payload: { init_data: initData },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as {
      token: string;
      expires_at: string;
      user: {
        id: string;
        email: string;
        telegram_user_id: number | null;
        display_name: string | null;
      };
    };
    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3); // header.payload.signature
    expect(body.user.email).toBe(`tg-${telegramUserId}@poruch.local`);
    expect(body.user.telegram_user_id).toBe(telegramUserId);
    expect(body.user.display_name).toBe('Дмитро');

    // Sanity: row exists in public.users with the right TG id.
    const { data: row } = await supabaseAdmin
      .from('users')
      .select('id, email, telegram_user_id, display_name')
      .eq('id', body.user.id)
      .single();
    expect(row?.telegram_user_id).toBe(telegramUserId);
  });

  it('idempotent: second call with same initData returns the same user', async () => {
    const telegramUserId = 9_100_000_000 + Math.floor(Math.random() * 1_000_000);
    cleanupTelegramIds.push(telegramUserId);

    const init1 = makeInitData({ telegramUserId, firstName: 'Anna' });
    const r1 = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      headers: { 'content-type': 'application/json' },
      payload: { init_data: init1 },
    });
    expect(r1.statusCode).toBe(200);
    const id1 = (r1.json() as { user: { id: string } }).user.id;

    const init2 = makeInitData({ telegramUserId, firstName: 'Anna' });
    const r2 = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      headers: { 'content-type': 'application/json' },
      payload: { init_data: init2 },
    });
    expect(r2.statusCode).toBe(200);
    const id2 = (r2.json() as { user: { id: string } }).user.id;
    expect(id2).toBe(id1);
  });

  it('rejects tampered initData with 400 invalid_init_data', async () => {
    const telegramUserId = 9_200_000_000 + Math.floor(Math.random() * 1_000_000);
    const initData = makeInitData({ telegramUserId });
    // Flip one byte of the hash.
    const tampered = initData.replace(/hash=([0-9a-f]+)/, (_, h: string) => {
      const flipped = (h.charCodeAt(0) === 'a'.charCodeAt(0) ? 'b' : 'a') + h.slice(1);
      return `hash=${flipped}`;
    });

    const res = await app.inject({
      method: 'POST',
      url: '/auth/telegram',
      headers: { 'content-type': 'application/json' },
      payload: { init_data: tampered },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json() as { ok: false; error: string };
    expect(body.ok).toBe(false);
    expect(body.error).toBe('invalid_init_data');
  });
});
