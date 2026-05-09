import type { FastifyInstance, FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.js';
import { verifySessionJwt } from '../services/session.service.js';

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header);
  return match?.[1] ?? null;
}

// Strict guard: missing/invalid token → 401. Used as a preHandler.
export async function authGuard(req: FastifyRequest): Promise<void> {
  const token = extractBearer(req);
  if (!token) throw AppError.unauthenticated('Missing bearer token');

  // Local HS256 verify against SESSION_JWT_SECRET. Telegram-only auth, so the
  // only tokens we ever see are the ones we minted in /auth/telegram.
  const claims = await verifySessionJwt(token);
  req.user = { id: claims.id, email: claims.email, role: claims.role };
  req.accessToken = token;
}

// Soft guard: if a Bearer token is present, verify it and populate req.user;
// if absent, leave req.user undefined and proceed. Used by public endpoints
// that decorate responses when the caller is authed (GET /opportunities/:id).
export async function softAuth(req: FastifyRequest): Promise<void> {
  const token = extractBearer(req);
  if (!token) return;
  try {
    const claims = await verifySessionJwt(token);
    req.user = { id: claims.id, email: claims.email, role: claims.role };
    req.accessToken = token;
  } catch {
    // Soft path: a present-but-invalid token should NOT 401 a public route.
    // We just don't decorate.
  }
}

export function registerAuthGuardDecorator(app: FastifyInstance): void {
  app.decorate('authGuard', authGuard);
  app.decorate('softAuth', softAuth);
}

declare module 'fastify' {
  interface FastifyInstance {
    authGuard: typeof authGuard;
    softAuth: typeof softAuth;
  }
}
