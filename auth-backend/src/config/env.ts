import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

// Treat empty-string env values as "unset" so dotenv lines like
// `SESSION_JWT_SECRET=` fall through to schema defaults instead of failing
// length checks. Removes the surprise where commenting out a value works but
// leaving it blank fails validation.
for (const k of Object.keys(process.env)) {
  if (process.env[k] === '') delete process.env[k];
}

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  CORS_ORIGINS: z.string().min(1).default('http://localhost:3000'),
  RATE_LIMIT_AUTH_MAX: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_AUTH_WINDOW: z.string().min(1).default('1m'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Our own session-signing secret. Supabase projects on the new asymmetric
  // model (ES256 + JWKS) don't expose a symmetric "JWT secret" we could use,
  // so we sign + verify our own HS256 tokens with this value. PostgREST will
  // not accept these — direct-to-PostgREST is not on the table for now.
  SESSION_JWT_SECRET: z.string().min(16).default('placeholder-session-jwt-secret-change-me'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(86400),

  // Check-in QR token: short-lived JWT minted by GET /opportunities/:id/check-in-token,
  // shown to organizer's scanner at the venue. Long enough to walk over with the
  // QR open, short enough to limit replay if the QR is photographed.
  CHECK_IN_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(600),

  // Telegram link token: HMAC-SHA256 secret shared with the bot for the
  // /me/telegram/link endpoint (separate from the initData-driven login).
  TELEGRAM_LINK_SECRET: z.string().min(16).default('placeholder-telegram-link-secret-change-me'),
  TELEGRAM_LINK_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),

  // Bot ↔ backend signing secret. Used by POST /internal/event-rooms/attach to
  // authenticate requests from the Telegram bot Edge Function. Bot signs the
  // raw JSON body with HMAC-SHA256 hex; backend verifies with timing-safe
  // compare. MUST be the same value on both sides (`supabase secrets set
  // BOT_INTERNAL_SECRET=<value>` for the bot, Railway env for here).
  BOT_INTERNAL_SECRET: z.string().min(16).default('placeholder-bot-internal-secret-change-me'),

  // initData freshness window per Telegram WebApp spec recommendation.
  TELEGRAM_INIT_DATA_MAX_AGE_SECONDS: z.coerce.number().int().positive().default(86400),

  // Telegram Bot API: required for the dispatch + room provisioning workers.
  // Defaulted to empty so HAS_REAL_TG=false suites can still boot the app.
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_BOT_USERNAME: z.string().default(''),

  // Worker tunables.
  INVITATIONS_TOP_N: z.coerce.number().int().positive().default(25),
  DISPATCH_BATCH_SIZE: z.coerce.number().int().positive().default(50),
  ROOMS_PROVISION_BATCH_SIZE: z.coerce.number().int().positive().default(20),

  // When true, workers log what they would do but don't hit Telegram.
  DRY_RUN: z
    .string()
    .transform((s) => s === '1' || s.toLowerCase() === 'true')
    .default('false'),

  // Optional: backend-generated `ai_reason` per opportunity in /feed.
  // If unset, the feed returns ai_reason as empty string.
  GEMINI_API_KEY: z.string().default(''),
  GEMINI_MODEL: z.string().default('gemini-2.0-flash'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  // Fail fast on missing/malformed env so we never boot half-configured.
  // eslint-disable-next-line no-console
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = {
  ...parsed.data,
  CORS_ORIGINS_LIST: parsed.data.CORS_ORIGINS.split(',')
    .map((s) => s.trim())
    .filter(Boolean),
};

export type Env = typeof env;
