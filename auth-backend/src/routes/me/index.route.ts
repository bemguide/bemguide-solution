import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, onboardingPatchSchema } from '../../utils/validation.js';
import { getById, upsertOnboarding } from '../../services/users.service.js';

// Canonical user surface per the v2 frontend contract.
// GET /me returns the V2User; PATCH /me accepts the partial onboarding shape.
//
// /auth/me (in auth/me.route.ts) is the same shape under a legacy path that
// the email/password lane historically used; both stay registered.
export async function meIndexRoute(app: FastifyInstance): Promise<void> {
  app.get('/me', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const profile = await getById(req.user.id);
    if (!profile) throw AppError.notFound('User profile not found', 'user_not_found');
    return profile;
  });

  app.patch('/me', { preHandler: authGuard }, async (req) => {
    if (!req.user || !req.accessToken) throw AppError.unauthenticated();
    const patch = parseOrThrow(onboardingPatchSchema, req.body, 'me patch');
    const profile = await upsertOnboarding(req.accessToken, req.user.id, patch);
    return profile;
  });
}
