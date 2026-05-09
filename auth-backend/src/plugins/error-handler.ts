import type { FastifyInstance } from 'fastify';
import { AppError, type ErrorEnvelope } from '../utils/errors.js';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      reply.status(err.statusCode).send(err.toEnvelope());
      return;
    }

    // Fastify validation / 4xx that bubble up with a statusCode
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      const envelope: ErrorEnvelope = {
        error: {
          code: err.statusCode === 429 ? 'RATE_LIMITED' : 'VALIDATION_FAILED',
          message: err.message,
        },
      };
      reply.status(err.statusCode).send(envelope);
      return;
    }

    req.log.error({ err }, 'unhandled error');
    const envelope: ErrorEnvelope = {
      error: { code: 'INTERNAL', message: 'Internal server error' },
    };
    reply.status(500).send(envelope);
  });

  app.setNotFoundHandler((_req, reply) => {
    const envelope: ErrorEnvelope = {
      error: { code: 'NOT_FOUND', message: 'Route not found' },
    };
    reply.status(404).send(envelope);
  });
}
