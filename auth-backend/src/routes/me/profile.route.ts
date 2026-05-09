import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow, onboardingPatchSchema } from '../../utils/validation.js';
import { getById, upsertOnboarding } from '../../services/users.service.js';

export async function meProfileRoute(app: FastifyInstance): Promise<void> {
  // GET /me/profile — same shape as GET /auth/me but on a route the client
  // can poll independently. Useful while the bot is filling onboarding.
  app.get('/me/profile', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const profile = await getById(req.user.id);
    if (!profile) throw AppError.notFound('User profile not found');
    return { profile };
  });

  // PATCH /me/profile — Q1–Q12 onboarding upsert via user-token client (RLS
  // self_update). Update of city/interests/accessibility_flags/age_range/
  // company_preference/veteran_status fires users_match_recompute.
  app.patch('/me/profile', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const patch = parseOrThrow(onboardingPatchSchema, req.body, 'onboarding patch');
    const profile = await upsertOnboarding(req.user.id, patch);
    return { profile };
  });
}
