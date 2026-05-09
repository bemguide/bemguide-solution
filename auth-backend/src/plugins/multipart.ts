import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';

export async function registerMultipart(app: FastifyInstance): Promise<void> {
  await app.register(multipart, {
    limits: {
      // Generous for first cut; tightened during Phase 6 hardening.
      fileSize: 25 * 1024 * 1024,
      files: 4,
      fields: 20,
    },
  });
}
