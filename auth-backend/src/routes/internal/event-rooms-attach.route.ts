import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { parseOrThrow } from '../../utils/validation.js';
import { supabaseAdmin } from '../../config/supabase.js';

// Body shape — must match the bot's `attachChatToEvent` in
// supabase/functions/bot/index.ts. The bot signs the raw JSON string of this
// shape with HMAC-SHA256(BOT_INTERNAL_SECRET) and sends the hex digest as
// `x-bot-signature`.
const attachBodySchema = z.object({
  event_id: z.string().uuid(),
  chat_id: z.string().min(1).max(64),
  chat_invite_url: z.string().url().max(512),
});

const SIG_HEADER = 'x-bot-signature';
// HMAC-SHA256 hex output is exactly 32 bytes = 64 hex chars.
const SIG_HEX_RE = /^[0-9a-f]{64}$/i;

// Augment FastifyRequest just for this scope so TS sees rawBody.
interface RequestWithRawBody extends FastifyRequest {
  rawBody?: string;
}

function verifyBotSignature(req: RequestWithRawBody): void {
  const sig = req.headers[SIG_HEADER];
  if (typeof sig !== 'string' || !SIG_HEX_RE.test(sig)) {
    throw new AppError({
      code: 'bot_signature_invalid',
      message: 'Missing or malformed x-bot-signature header',
      statusCode: 401,
    });
  }
  const raw = req.rawBody;
  if (typeof raw !== 'string') {
    // The encapsulated content-type parser below populates this; if it didn't,
    // something is wrong with the route registration order.
    throw AppError.internal('Raw body not captured for signature verification');
  }

  const expected = crypto.createHmac('sha256', env.BOT_INTERNAL_SECRET).update(raw).digest();
  const provided = Buffer.from(sig, 'hex');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    throw new AppError({
      code: 'bot_signature_invalid',
      message: 'Invalid bot signature',
      statusCode: 401,
    });
  }
}

export async function eventRoomsAttachRoute(app: FastifyInstance): Promise<void> {
  // Encapsulate so the raw-body content-type parser doesn't replace the global
  // JSON parser used by every other route. Inside this register() callback,
  // requests get a `rawBody` property; outside, parsing is unchanged.
  await app.register(async (instance) => {
    instance.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
      (req as RequestWithRawBody).rawBody = body as string;
      try {
        done(null, JSON.parse(body as string));
      } catch (err) {
        done(err as Error, undefined);
      }
    });

    instance.post('/internal/event-rooms/attach', async (req, reply) => {
      verifyBotSignature(req as RequestWithRawBody);

      const { event_id, chat_id, chat_invite_url } = parseOrThrow(
        attachBodySchema,
        req.body,
        'attach body',
      );

      const { data: opp, error: oppErr } = await supabaseAdmin
        .from('opportunities')
        .select('id')
        .eq('id', event_id)
        .maybeSingle();
      if (oppErr) throw AppError.upstream('Failed to load opportunity', oppErr.message);
      if (!opp) throw AppError.notFound('Opportunity not found', 'opportunity_not_found');

      // Refuse re-attaching a chat that's already bound to a different event.
      // Idempotent on the same (event_id, chat_id) pair — UPSERT below covers
      // re-runs when the user re-triggers from the Mini App after promoting
      // the bot to admin.
      const { data: existingByChat, error: chatLookupErr } = await supabaseAdmin
        .from('event_rooms')
        .select('event_id')
        .eq('chat_external_id', chat_id)
        .neq('event_id', event_id)
        .maybeSingle();
      if (chatLookupErr) {
        throw AppError.upstream('Failed to lookup chat binding', chatLookupErr.message);
      }
      if (existingByChat) {
        throw AppError.conflict(
          'That Telegram chat is already attached to a different event',
          'chat_already_attached_to_different_event',
        );
      }

      // UPSERT: row may already exist (event_attendees_create_room trigger
      // inserts on first RSVP with chat_provider=NULL); we fill the chat
      // fields here. If no attendees yet, this insert seeds the row.
      const { data: room, error: upsertErr } = await supabaseAdmin
        .from('event_rooms')
        .upsert(
          {
            event_id,
            chat_provider: 'telegram',
            chat_external_id: chat_id,
            chat_invite_url,
            chat_created_at: new Date().toISOString(),
          },
          { onConflict: 'event_id' },
        )
        .select('*')
        .single();
      if (upsertErr || !room) {
        throw AppError.upstream('Failed to attach chat to event', upsertErr?.message);
      }

      reply.code(200);
      return { ok: true, room };
    });
  });
}
