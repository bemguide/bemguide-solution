import cors from '@fastify/cors';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';

// Allow exact-match origins from CORS_ORIGINS env, plus wildcards for ngrok
// dev tunnels. Mini App previews typically run on https://<id>.ngrok-free.app
// or .dev — list one explicitly there is too brittle.
const NGROK_HOST_RE = /^https:\/\/[a-z0-9-]+\.ngrok-free\.(app|dev)$/i;
const VERCEL_HOST_RE = /^https:\/\/[a-z0-9-]+\.vercel\.app$/i;

export async function registerCors(app: FastifyInstance): Promise<void> {
  const exactAllowed = new Set(env.CORS_ORIGINS_LIST);

  await app.register(cors, {
    origin: (origin, cb) => {
      // Same-origin / curl / server-to-server requests have no Origin header.
      if (!origin) {
        cb(null, true);
        return;
      }
      if (exactAllowed.has(origin) || NGROK_HOST_RE.test(origin) || VERCEL_HOST_RE.test(origin)) {
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
