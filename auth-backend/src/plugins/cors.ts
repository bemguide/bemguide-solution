import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

// Allow exact-match origins from CORS_ORIGINS env, plus wildcards for ngrok
// dev tunnels and Telegram Web clients. Mini App previews typically run on
// https://<id>.ngrok-free.app or .dev — listing one explicitly is too brittle.
// Telegram Web (web.telegram.org and its k./a./z. subdomain variants) is the
// canonical origin when a user opens the Mini App from desktop/web Telegram.
const NGROK_HOST_RE = /^https:\/\/[a-z0-9-]+\.ngrok-free\.(app|dev)$/i;
const VERCEL_HOST_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;
const TELEGRAM_WEB_RE = /^https:\/\/(?:[a-z]+\.)?web\.telegram\.org$/i;

export async function registerCors(app: FastifyInstance): Promise<void> {
  const exactAllowed = new Set(env.CORS_ORIGINS_LIST);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server / native Telegram WebView
      // requests have no Origin header. Native iOS/Android Telegram clients
      // typically fall into this branch.
      if (!origin) {
        cb(null, true);
        return;
      }
      if (
        exactAllowed.has(origin) ||
        NGROK_HOST_RE.test(origin) ||
        VERCEL_HOST_RE.test(origin) ||
        TELEGRAM_WEB_RE.test(origin)
      ) {
        cb(null, true);
        return;
      }
      cb(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept', 'X-Telegram-InitData'],
    maxAge: 600,
  });
}
