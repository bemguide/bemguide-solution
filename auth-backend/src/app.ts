import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loggerOptions } from './utils/logger.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerCors } from './plugins/cors.js';
import { registerMultipart } from './plugins/multipart.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerAuthGuardDecorator } from './plugins/auth-guard.js';
import { healthRoute } from './routes/health.route.js';
import { registerRoute } from './routes/auth/register.route.js';
import { loginRoute } from './routes/auth/login.route.js';
import { refreshRoute } from './routes/auth/refresh.route.js';
import { logoutRoute } from './routes/auth/logout.route.js';
import { meRoute } from './routes/auth/me.route.js';
import { pendingRoute } from './routes/admin/pending.route.js';
import { reviewRoute } from './routes/admin/review.route.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    bodyLimit: 10 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(sensible);
  await registerCors(app);
  await registerMultipart(app);
  await registerRateLimit(app);
  registerAuthGuardDecorator(app);

  registerErrorHandler(app);

  await app.register(healthRoute);
  await app.register(registerRoute);
  await app.register(loginRoute);
  await app.register(refreshRoute);
  await app.register(logoutRoute);
  await app.register(meRoute);
  await app.register(pendingRoute);
  await app.register(reviewRoute);

  return app;
}
