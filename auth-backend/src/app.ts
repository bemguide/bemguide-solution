import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { loggerOptions } from './utils/logger.js';
import { registerErrorHandler } from './plugins/error-handler.js';
import { registerCors } from './plugins/cors.js';
import { registerRateLimit } from './plugins/rate-limit.js';
import { registerAuthGuardDecorator } from './plugins/auth-guard.js';

import { healthRoute } from './routes/health.route.js';

// Auth — Telegram-only per the v2 contract. The email/password lane was
// dropped because Supabase signs its tokens with ES256 (private key in their
// KMS, public key via JWKS) and we can't reissue compatible ones.
import { telegramAuthRoute } from './routes/auth/telegram.route.js';

// /me canonical surface (per v2 contract).
import { meIndexRoute } from './routes/me/index.route.js';
import { meProfileRoute } from './routes/me/profile.route.js';
import { meTelegramRoute } from './routes/me/telegram.route.js';
import { meMatchesRoute } from './routes/me/matches.route.js';
import { meInvitationsRoute } from './routes/me/invitations.route.js';
import { meAttendanceRoute } from './routes/me/attendance.route.js';
import { meUpcomingRoute } from './routes/me/upcoming.route.js';

// Public + authed opportunity surface.
import { opportunitiesIndexRoute } from './routes/opportunities/index.route.js';
import { opportunityByIdRoute } from './routes/opportunities/by-id.route.js';
import { opportunityAttendeesRoute } from './routes/opportunities/attendees.route.js';
import { opportunityRsvpRoute } from './routes/opportunities/rsvp.route.js';
import { opportunityRoomRoute } from './routes/opportunities/room.route.js';

// Personalised + match endpoints.
import { feedRoute } from './routes/feed.route.js';
import { matchesRoute } from './routes/matches.route.js';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: loggerOptions,
    bodyLimit: 256 * 1024,
    trustProxy: true,
  });

  await app.register(sensible);
  await registerCors(app);
  await registerRateLimit(app);
  registerAuthGuardDecorator(app);

  registerErrorHandler(app);

  await app.register(healthRoute);

  // Auth
  await app.register(telegramAuthRoute);

  // Me
  await app.register(meIndexRoute);
  await app.register(meProfileRoute);
  await app.register(meTelegramRoute);
  await app.register(meMatchesRoute);
  await app.register(meInvitationsRoute);
  await app.register(meAttendanceRoute);
  await app.register(meUpcomingRoute);

  // Opportunities
  await app.register(opportunitiesIndexRoute);
  await app.register(opportunityByIdRoute);
  await app.register(opportunityAttendeesRoute);
  await app.register(opportunityRsvpRoute);
  await app.register(opportunityRoomRoute);

  // Feed + matches
  await app.register(feedRoute);
  await app.register(matchesRoute);

  return app;
}
