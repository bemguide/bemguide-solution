import type { FastifyInstance } from 'fastify';
import { AppError, type ErrorEnvelope } from '../utils/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(err.toEnvelope());
      return;
    }

    // Fastify-internal / 4xx errors with a statusCode (rate limiter, body parser, …).
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      const envelope: ErrorEnvelope = {
        ok: false,
        error: err.statusCode === 429 ? 'rate_limited' : 'validation_failed',
        message: err.message,
      };
      reply.status(err.statusCode).send(envelope);
      return;
    }

    req.log.error({ err }, 'unhandled error');
    const envelope: ErrorEnvelope = {
      ok: false,
      error: 'internal',
      message: 'Internal server error',
    };
    reply.status(500).send(envelope);
  });

  app.setNotFoundHandler((_req, reply) => {
    const envelope: ErrorEnvelope = {
      ok: false,
      error: 'not_found',
      message: 'Route not found',
    };
    reply.status(404).send(envelope);
  });
}
