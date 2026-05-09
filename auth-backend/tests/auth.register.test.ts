import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { buildMultipart, fakePng } from './helpers/multipart.js';
import { HAS_REAL_SERVICE_ROLE, deleteUserByEmail, uniqueEmail } from './helpers/supabase-test.js';
import { supabaseAdmin } from '../src/config/supabase.js';
import { ensureBucketExists } from '../src/services/storage.service.js';

const describeIfReal = HAS_REAL_SERVICE_ROLE ? describe : describe.skip;

describeIfReal('POST /auth/register (integration)', () => {
  let app: FastifyInstance;
  const cleanupEmails: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
    await ensureBucketExists();
  });

  afterAll(async () => {
    for (const email of cleanupEmails) {
      await deleteUserByEmail(email).catch(() => {});
    }
    await app.close();
  });

  it('creates a user, uploads files, inserts profile, returns session', async () => {
    const email = uniqueEmail('register-happy');
    cleanupEmails.push(email);

    const { payload, headers } = buildMultipart(
      {
        email,
        password: 'CorrectHorseBattery9!',
        full_name: 'Test User',
        document_type: 'passport',
      },
      [
        {
          field: 'document_image',
          filename: 'doc.png',
          contentType: 'image/png',
          buffer: fakePng('doc'),
        },
        {
          field: 'selfie_image',
          filename: 'selfie.png',
          contentType: 'image/png',
          buffer: fakePng('selfie'),
        },
      ],
    );

    const res = await app.inject({
      method: 'POST',
      url: '/auth/register',
      headers,
      payload,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json() as {
      user: { id: string; email: string };
      profile: { verification_status: string; document_type: string };
      session: { access_token: string; refresh_token: string };
    };
    expect(body.user.email).toBe(email);
    expect(body.profile.verification_status).toBe('pending');
    expect(body.profile.document_type).toBe('passport');
    expect(typeof body.session.access_token).toBe('string');
    expect(typeof body.session.refresh_token).toBe('string');
    // Sensitive paths must not leak.
    expect(body.profile).not.toHaveProperty('document_image_path');
    expect(body.profile).not.toHaveProperty('selfie_image_path');

    // Sanity: row exists in profiles.
    const { data: row } = await supabaseAdmin
      .from('profiles')
      .select('verification_status,document_type')
      .eq('id', body.user.id)
      .single();
    expect(row?.verification_status).toBe('pending');
  });

  it('rejects duplicate email with 409', async () => {
    const email = uniqueEmail('register-dup');
    cleanupEmails.push(email);

    const make = () =>
      buildMultipart(
        {
          email,
          password: 'CorrectHorseBattery9!',
          full_name: 'Dup Tester',
          document_type: 'id_card',
        },
        [
          {
            field: 'document_image',
            filename: 'd.png',
            contentType: 'image/png',
            buffer: fakePng('d'),
          },
          {
            field: 'selfie_image',
            filename: 's.png',
            contentType: 'image/png',
            buffer: fakePng('s'),
          },
        ],
      );

    const first = await app.inject({ method: 'POST', url: '/auth/register', ...make() });
    expect(first.statusCode).toBe(201);

    const second = await app.inject({ method: 'POST', url: '/auth/register', ...make() });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({
      error: { code: 'CONFLICT', message: 'Email is already registered' },
    });
  });

  it('rejects missing fields with 400', async () => {
    const { payload, headers } = buildMultipart({ email: 'x@y.com' }, []);
    const res = await app.inject({ method: 'POST', url: '/auth/register', headers, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('POST /auth/register (offline guard)', () => {
  it('logs a clear note when SUPABASE_SERVICE_ROLE_KEY is a placeholder', () => {
    if (HAS_REAL_SERVICE_ROLE) return;
    // eslint-disable-next-line no-console
    console.warn(
      'Integration tests are skipped because SUPABASE_SERVICE_ROLE_KEY is a placeholder. Paste the real key in .env to enable them.',
    );
    expect(HAS_REAL_SERVICE_ROLE).toBe(false);
  });
});
