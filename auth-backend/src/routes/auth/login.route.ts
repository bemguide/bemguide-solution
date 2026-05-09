import type { FastifyInstance } from 'fastify';
import { AppError } from '../../utils/errors.js';
import { validateLoginInput } from '../../utils/validation.js';
import { signInWithPassword } from '../../services/auth.service.js';
import { getProfileById } from '../../services/profile.service.js';
import { authRateLimitConfig } from '../../plugins/rate-limit.js';

interface LoginBody {
  email?: string;
  password?: string;
}

export async function loginRoute(app: FastifyInstance): Promise<void> {
  app.post('/auth/login', authRateLimitConfig(), async (req) => {
    const body = (req.body ?? {}) as LoginBody;
    if (!body.email || !body.password) {
      throw AppError.validation('email and password are required');
    }
    validateLoginInput(body); // stub

    const signed = await signInWithPassword(body.email, body.password);
    const profile = await getProfileById(signed.userId);

    return {
      user: { id: signed.userId, email: signed.email },
      profile: profile
        ? {
            id: profile.id,
            email: profile.email,
            full_name: profile.full_name,
            document_type: profile.document_type,
            verification_status: profile.verification_status,
            created_at: profile.created_at,
            updated_at: profile.updated_at,
          }
        : null,
      session: signed.session,
    };
  });
}
