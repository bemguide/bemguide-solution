import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { buildMultipart, fakePng } from './helpers/multipart.js';
import { HAS_REAL_SERVICE_ROLE, deleteUserByEmail, uniqueEmail } from './helpers/supabase-test.js';
import { ensureBucketExists } from '../src/services/storage.service.js';
import { supabaseAdmin } from '../src/config/supabase.js';

const describeIfReal = HAS_REAL_SERVICE_ROLE ? describe : describe.skip;

interface SessionShape {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: 'bearer';
}

interface RegisterResult {
  userId: string;
  session: SessionShape;
}

describeIfReal('Admin review flow', () => {
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

  async function registerUser(email: string): Promise<RegisterResult> {
    const { payload, headers } = buildMultipart(
      {
        email,
        password: 'CorrectHorseBattery9!',
        full_name: 'Reviewable User',
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
    const res = await app.inject({ method: 'POST', url: '/auth/register', headers, payload });
    expect(res.statusCode).toBe(201);
    const body = res.json() as { user: { id: string }; session: SessionShape };
    return { userId: body.user.id, session: body.session };
  }

  async function freshLogin(email: string): Promise<SessionShape> {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/login',
      payload: { email, password: 'CorrectHorseBattery9!' },
    });
    expect(res.statusCode).toBe(200);
    return (res.json() as { session: SessionShape }).session;
  }

  it('non-admin cannot list or review', async () => {
    const email = uniqueEmail('non-admin');
    cleanupEmails.push(email);
    const { session } = await registerUser(email);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/users/pending',
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    expect(list.statusCode).toBe(403);
    expect(list.json().error.code).toBe('FORBIDDEN');
  });

  it('admin can list, approve, and reject', async () => {
    const adminEmail = uniqueEmail('admin');
    const userAEmail = uniqueEmail('userA');
    const userBEmail = uniqueEmail('userB');
    cleanupEmails.push(adminEmail, userAEmail, userBEmail);

    // Register the admin and two normal users
    const adminReg = await registerUser(adminEmail);
    const userA = await registerUser(userAEmail);
    const userB = await registerUser(userBEmail);

    // Promote admin
    await supabaseAdmin.auth.admin.updateUserById(adminReg.userId, {
      app_metadata: { role: 'admin' },
    });
    // Re-login so the JWT carries the new claim
    const adminSession = await freshLogin(adminEmail);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/users/pending?limit=50',
      headers: { authorization: `Bearer ${adminSession.access_token}` },
    });
    expect(list.statusCode).toBe(200);
    const listBody = list.json() as {
      items: Array<{ id: string; verification_status: string }>;
    };
    const ids = listBody.items.map((i) => i.id);
    expect(ids).toContain(userA.userId);
    expect(ids).toContain(userB.userId);

    const approve = await app.inject({
      method: 'POST',
      url: `/admin/users/${userA.userId}/approve`,
      headers: { authorization: `Bearer ${adminSession.access_token}` },
    });
    expect(approve.statusCode).toBe(200);
    expect(approve.json().profile.verification_status).toBe('approved');

    const reject = await app.inject({
      method: 'POST',
      url: `/admin/users/${userB.userId}/reject`,
      headers: { authorization: `Bearer ${adminSession.access_token}` },
      payload: { reason: 'document unreadable' },
    });
    expect(reject.statusCode).toBe(200);
    expect(reject.json().profile.verification_status).toBe('rejected');
    expect(reject.json().profile.rejection_reason).toBe('document unreadable');

    // Persistence check
    const { data: a } = await supabaseAdmin
      .from('profiles')
      .select('verification_status,reviewed_by')
      .eq('id', userA.userId)
      .single();
    expect(a?.verification_status).toBe('approved');
    expect(a?.reviewed_by).toBe(adminReg.userId);
  });

  it('reject without reason returns 400', async () => {
    const adminEmail = uniqueEmail('admin-noreason');
    const userEmail = uniqueEmail('victim');
    cleanupEmails.push(adminEmail, userEmail);

    const adminReg = await registerUser(adminEmail);
    const userReg = await registerUser(userEmail);
    await supabaseAdmin.auth.admin.updateUserById(adminReg.userId, {
      app_metadata: { role: 'admin' },
    });
    const adminSession = await freshLogin(adminEmail);

    const res = await app.inject({
      method: 'POST',
      url: `/admin/users/${userReg.userId}/reject`,
      headers: { authorization: `Bearer ${adminSession.access_token}` },
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('VALIDATION_FAILED');
  });
});

describe('Admin guard (offline)', () => {
  it('rejects unauthenticated calls to /admin/users/pending', async () => {
    const app = await buildTestApp();
    try {
      const res = await app.inject({ method: 'GET', url: '/admin/users/pending' });
      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
