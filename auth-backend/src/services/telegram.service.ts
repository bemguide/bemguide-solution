import { createHmac, timingSafeEqual } from 'node:crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

// ──────────────────────────────────────────────────────────────────────────
// One-time link token (bot → backend)
// ──────────────────────────────────────────────────────────────────────────
//
// Token format: `${payloadB64url}.${sigB64url}`
// payload = base64url(JSON({ telegram_user_id: bigint, nonce: hex, exp: unix }))
// sig     = HMAC-SHA256(secret, payload) → base64url
//
// Bot generates this when a user types /link inside the chat. Backend verifies
// the signature, expiry, and binds telegram_user_id to the auth user (whoever
// sent the bearer token to /me/telegram/link).
//
// nonce is included only as defence-in-depth (replay would still need a valid
// access token). No server-side replay store today.

interface LinkTokenPayload {
  telegram_user_id: number;
  nonce: string;
  exp: number;
}

export interface VerifiedLinkToken {
  telegram_user_id: number;
}

export function verifyOneTimeLinkToken(token: string): VerifiedLinkToken {
  const dot = token.indexOf('.');
  if (dot < 0) throw AppError.validation('Malformed link token');
  const payloadPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  const expected = createHmac('sha256', env.TELEGRAM_LINK_SECRET).update(payloadPart).digest();
  let provided: Buffer;
  try {
    provided = Buffer.from(sigPart, 'base64url');
  } catch {
    throw AppError.validation('Invalid link token signature encoding');
  }
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    throw AppError.unauthenticated('Invalid link token');
  }

  let payload: LinkTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw AppError.validation('Malformed link token payload');
  }

  if (
    typeof payload?.telegram_user_id !== 'number' ||
    typeof payload?.exp !== 'number' ||
    typeof payload?.nonce !== 'string'
  ) {
    throw AppError.validation('Malformed link token payload');
  }
  if (payload.exp < Math.floor(Date.now() / 1000)) {
    throw AppError.unauthenticated('Link token has expired');
  }
  return { telegram_user_id: payload.telegram_user_id };
}

// ──────────────────────────────────────────────────────────────────────────
// Bot API wrappers (dispatch + room provisioning workers)
// ──────────────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.telegram.org';

interface BotApiResponse<T> {
  ok: boolean;
  result?: T;
  description?: string;
}

async function callBotApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  if (env.DRY_RUN) {
    // Visible in worker logs; never reach the network.
    // eslint-disable-next-line no-console
    console.log(`[telegram dry-run] ${method}`, body);
    return { __dry_run: true } as unknown as T;
  }
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw AppError.upstream('TELEGRAM_BOT_TOKEN is not configured');
  }

  const res = await fetch(`${API_BASE}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as BotApiResponse<T>;
  if (!json.ok || !json.result) {
    throw AppError.upstream(`Telegram ${method} failed`, json.description ?? 'unknown error');
  }
  return json.result;
}

export interface SentMessage {
  message_id: number;
}

export async function sendMessage(chatId: number | string, text: string): Promise<SentMessage> {
  return callBotApi<SentMessage>('sendMessage', {
    chat_id: chatId,
    text,
    disable_web_page_preview: true,
  });
}

export interface CreatedChat {
  id: number;
}

// Bot API doesn't expose programmatic group/supergroup creation. The realistic
// flow is: bot creates a "channel" via createChatInviteLink-style ops on a
// pre-existing chat, OR an admin creates the chat manually and the worker
// just stores the invite link. For now we wrap that pattern as a stub the
// worker can call; in DRY_RUN it produces deterministic placeholders.
export async function createChatForEvent(eventId: string): Promise<{
  chat_external_id: string;
  chat_invite_url: string;
}> {
  if (env.DRY_RUN) {
    return {
      chat_external_id: `dry-run-chat-${eventId}`,
      chat_invite_url: `https://t.me/${env.TELEGRAM_BOT_USERNAME || 'bot'}?start=${eventId}`,
    };
  }
  // Real provisioning is bot-implementation-specific; flagged for the bot
  // owner to implement when this lands.
  throw AppError.upstream(
    'Telegram chat provisioning not implemented; run worker with DRY_RUN=1 until the bot wires this',
  );
}
