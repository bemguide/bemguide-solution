import type { FastifyRequest } from 'fastify';
import { AppError } from '../utils/errors.js';
import { authGuard } from './auth-guard.js';

export async function adminGuard(req: FastifyRequest): Promise<void> {
  await authGuard(req);
  if (req.user?.role !== 'admin') {
    throw AppError.forbidden('Admin role required');
  }
}
