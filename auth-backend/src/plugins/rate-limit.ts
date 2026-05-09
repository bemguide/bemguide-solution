import rateLimit from '@fastify/rate-limit';
import type { FastifyInstance } from 'fastify';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

export async function registerRateLimit(app: FastifyInstance): Promise<void> {
  await app.register(rateLimit, {
    global: false, // we'll attach per-route caps explicitly
    max: 100,
    timeWindow: '1m',
    errorResponseBuilder: () => {
      const err = new AppError({
        code: 'RATE_LIMITED',
        message: 'Too many requests',
        statusCode: 429,
      });
      // Fastify rate-limit returns whatever we throw via this builder.
      return err.toEnvelope();
    },
  });
}

export function authRateLimitConfig() {
  return {
    config: {
      rateLimit: {
        max: env.RATE_LIMIT_AUTH_MAX,
        timeWindow: env.RATE_LIMIT_AUTH_WINDOW,
      },
    },
  };
}
