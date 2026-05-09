import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { buildMultipart, fakePng } from './helpers/multipart.js';
import { HAS_REAL_SERVICE_ROLE, deleteUserByEmail, uniqueEmail } from './helpers/supabase-test.js';
import { ensureBucketExists } from '../src/services/storage.service.js';

const describeIfReal = HAS_REAL_SERVICE_ROLE ? describe : describe.skip;

interface SessionShape {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: 'bearer';
}

describeIfReal('Auth session lifecycle', () => {
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

  async function registerUser(email: string): Promise<SessionShape> {
    const { payload, headers } = buildMultipart(
      {
        email,
        password: 'CorrectHorseBattery9!',
        full_name: 'Session Tester',
        document_type: 'driver_license',
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
    const res = await app.inject({ method: 'POST', url: '/auth/register', headers, payload });
    expect(res.statusCode).toBe(201);
    return res.json().session as SessionShape;
  }

  it('login → refresh → me → logout', async () => {
    const email = uniqueEmail('session');
    cleanupEmails.push(email);
    await registerUser(email);

    const login = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'CorrectHorseBattery9!' },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json() as {
      session: SessionShape;
      profile: { verification_status: string };
    };
    expect(loginBody.profile.verification_status).toBe('pending');
    const accessToken = loginBody.session.access_token;
    const refreshToken = loginBody.session.refresh_token;

    const refresh = await app.inject({
      method: 'POST',
      url: '/auth/refresh',
      payload: { refresh_token: refreshToken },
    });
    expect(refresh.statusCode).toBe(200);
    expect(typeof (refresh.json().session as SessionShape).access_token).toBe('string');

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(me.statusCode).toBe(200);
    const meBody = me.json() as { document_url: string; selfie_url: string };
    expect(meBody.document_url).toMatch(/^https?:\/\//);
    expect(meBody.selfie_url).toMatch(/^https?:\/\//);

    const logout = await app.inject({
      method: 'POST',
      url: '/auth/logout',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(logout.statusCode).toBe(204);
  });

  it('login with wrong password returns 401 with generic message', async () => {
    const email = uniqueEmail('wrongpw');
    cleanupEmails.push(email);
    await registerUser(email);

    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'definitely-not-the-password' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' },
    });
  });

  it('login with unknown email returns 401 with same generic message (no enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email: uniqueEmail('nobody'), password: 'whatever' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({
      error: { code: 'UNAUTHENTICATED', message: 'Invalid email or password' },
    });
  });

  it('GET /auth/me without bearer returns 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('GET /auth/me with garbage bearer returns 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe('Auth session lifecycle (offline)', () => {
  it('unauthenticated /auth/me works without service role key', async () => {
    const app = await buildTestApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/auth/me' });
      expect(res.statusCode).toBe(401);
      expect(res.json().error.code).toBe('UNAUTHENTICATED');
    } finally {
      await app.close();
    }
  });
});
