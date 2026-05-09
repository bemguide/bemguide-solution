import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.js';
import { getUserFromToken } from '../services/auth.service.js';

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

export async function authGuard(req: FastifyRequest): Promise<void> {
  const token = extractBearer(req);
  if (!token) throw AppError.unauthenticated('Missing bearer token');

  const user = await getUserFromToken(token);
  if (!user) throw AppError.unauthenticated('Invalid or expired token');

  req.user = user;
  req.accessToken = token;
}

export function registerAuthGuardDecorator(app: FastifyInstance): void {
  app.decorate('authGuard', authGuard);
}

declare module 'fastify' {
  interface FastifyInstance {
    authGuard: typeof authGuard;
  }
}
