import type { FastifyInstance } from 'fastify';
import { authGuard } from '../../plugins/auth-guard.js';
import { AppError } from '../../utils/errors.js';
import { getProfileById } from '../../services/profile.service.js';
import { signedUrlFor } from '../../services/storage.service.js';

export async function meRoute(app: FastifyInstance): Promise<void> {
  app.get('/auth/me', { preHandler: authGuard }, async (req) => {
    if (!req.user) throw AppError.unauthenticated();
    const profile = await getProfileById(req.user.id);
    if (!profile) throw AppError.notFound('Profile not found');

    const [documentUrl, selfieUrl] = await Promise.all([
      signedUrlFor(profile.document_image_path),
      signedUrlFor(profile.selfie_image_path),
    ]);

    return {
      user: { id: req.user.id, email: req.user.email },
      profile: {
        id: profile.id,
        email: profile.email,
        full_name: profile.full_name,
        document_type: profile.document_type,
        verification_status: profile.verification_status,
        rejection_reason: profile.rejection_reason,
        reviewed_at: profile.reviewed_at,
        created_at: profile.created_at,
        updated_at: profile.updated_at,
      },
      document_url: documentUrl,
      selfie_url: selfieUrl,
    };
  });
}
