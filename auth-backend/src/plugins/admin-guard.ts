import type { FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.js';
import { authGuard } from './auth-guard.js';

// preHandler that runs authGuard then checks for an admin role on the user's
// app_metadata. Service-role-bypass is intentionally NOT a path here — admin
// endpoints must always be reached with a real admin user's bearer token.
export async function adminGuard(req: FastifyRequest): Promise<void> {
  await authGuard(req);
  if (req.user?.role !== 'admin') {
    throw AppError.forbidden('Admin role required');
  }
}
