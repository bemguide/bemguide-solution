import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SignJWT } from 'jose';
import type { FastifyInstance } from 'fastify';
import { buildTestApp } from './helpers/test-app.js';
import { HAS_REAL_SERVICE_ROLE } from './helpers/supabase-test.js';
import { supabaseAdmin } from '../src/config/supabase.js';
import { env } from '../src/config/env.js';
import { mintSessionJwt, mintCheckInToken } from '../src/services/session.service.js';

// Mint a session JWT with an arbitrary role (production code only mints
// 'authenticated'; tests need 'admin' too). Uses the same secret + audience
// as session.service.ts so authGuard accepts it.
async function mintAdminJwt(userId: string, email: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const secret = new TextEncoder().encode(env.SESSION_JWT_SECRET);
  return await new SignJWT({ email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('auth-backend')
    .setAudience('mini-app')
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(secret);
}

interface TestUser {
  id: string;
  email: string;
  bearer: string;
}

async function createUser(role: 'authenticated' | 'admin'): Promise<TestUser> {
  const email = `checkin-test+${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
  // email_confirm:true so we can create + use immediately (memory:
  // feedback_supabase_register_email_confirm).
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password: 'test-password-12345',
    email_confirm: true,
  });
  if (error || !data.user) throw new Error(`createUser failed: ${error?.message}`);
  const userId = data.user.id;

  // public.users row — id FKs to auth.users.id; required by event_attendees FK.
  const { error: profErr } = await supabaseAdmin.from('users').insert({
    id: userId,
    email,
    city: 'Kyiv',
  });
  if (profErr) throw new Error(`users insert failed: ${profErr.message}`);

  const bearer =
    role === 'admin'
      ? await mintAdminJwt(userId, email)
      : (await mintSessionJwt(userId, email)).token;

  return { id: userId, email, bearer };
}

async function createOpportunityFor(organizerId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('opportunities')
    .insert({
      title: 'Test Event',
      city: 'Kyiv',
      location_lat: 50.45,
      location_lng: 30.52,
      created_by: organizerId,
      // start_at far in the future — RSVP guard refuses past events.
      start_at: new Date(Date.now() + 24 * 3600 * 1000).toISOString().replace('Z', ''),
      duration_min: 60,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`opportunity insert failed: ${error?.message}`);
  return data.id;
}

const describeIfReal = HAS_REAL_SERVICE_ROLE ? describe : describe.skip;

describeIfReal('opportunity ownership + check-in', () => {
  let app: FastifyInstance;
  const cleanupUserIds: string[] = [];
  const cleanupOpportunityIds: string[] = [];

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    // Opportunities cascade to event_attendees / event_rooms / event_matches /
    // event_invitations via their FKs.
    if (cleanupOpportunityIds.length) {
      await supabaseAdmin.from('opportunities').delete().in('id', cleanupOpportunityIds);
    }
    for (const id of cleanupUserIds) {
      await supabaseAdmin.from('users').delete().eq('id', id);
      await supabaseAdmin.auth.admin.deleteUser(id).catch(() => {});
    }
    await app.close();
  });

  it('creator auto-becomes attendee when an opportunity is inserted', async () => {
    const organizer = await createUser('authenticated');
    cleanupUserIds.push(organizer.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    const { data: attendee, error } = await supabaseAdmin
      .from('event_attendees')
      .select('*')
      .eq('event_id', oppId)
      .eq('user_id', organizer.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(attendee).not.toBeNull();
    expect(attendee?.status).toBe('joining');
    expect(attendee?.show_name_publicly).toBe(false);
  });

  it('admin scanner with valid token transitions joining → attended', async () => {
    const organizer = await createUser('authenticated');
    const admin = await createUser('admin');
    cleanupUserIds.push(organizer.id, admin.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    const { token } = await mintCheckInToken(organizer.id, oppId);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.attendee.status).toBe('attended');
    expect(body.attendee.user_id).toBe(organizer.id);
    expect(body.user?.id).toBe(organizer.id);
  });

  it('organizer (non-admin) of THIS event can check attendees in', async () => {
    const organizer = await createUser('authenticated');
    cleanupUserIds.push(organizer.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    // Self-check-in is a degenerate case but works: the organizer is also an
    // attendee (auto-added) and is authorized to check anyone in including
    // themselves.
    const { token } = await mintCheckInToken(organizer.id, oppId);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${organizer.bearer}` },
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().attendee.status).toBe('attended');
  });

  it('any authenticated user can scan a valid QR (no organizer gate)', async () => {
    // Verification trust is on the signed QR token, not on the scanner role.
    // See check-in.route.ts header: created_by is unpopulated for existing
    // inventory, so an organizer-only gate would 403 every real scan.
    const organizer = await createUser('authenticated');
    const stranger = await createUser('authenticated');
    cleanupUserIds.push(organizer.id, stranger.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    const { token } = await mintCheckInToken(organizer.id, oppId);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${stranger.bearer}` },
      payload: { token },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().attendee.status).toBe('attended');
  });

  it('returns 401 when token is for a different event', async () => {
    const organizer = await createUser('authenticated');
    const admin = await createUser('admin');
    cleanupUserIds.push(organizer.id, admin.id);

    const oppA = await createOpportunityFor(organizer.id);
    const oppB = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppA, oppB);

    // Token bound to oppA, presented at oppB → mismatch.
    const { token } = await mintCheckInToken(organizer.id, oppA);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppB}/check-in`,
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when no attendee row exists for the token subject', async () => {
    const organizer = await createUser('authenticated');
    const ghost = await createUser('authenticated');
    const admin = await createUser('admin');
    cleanupUserIds.push(organizer.id, ghost.id, admin.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    // Mint a token for `ghost` who is NOT an attendee of this event. (Token
    // issuance route would refuse this; we mint directly to simulate a stale
    // or forged token.)
    const { token } = await mintCheckInToken(ghost.id, oppId);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 when attendee status is left/no_show', async () => {
    const organizer = await createUser('authenticated');
    const left = await createUser('authenticated');
    const admin = await createUser('admin');
    cleanupUserIds.push(organizer.id, left.id, admin.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    // Add `left` as attendee and immediately mark left.
    await supabaseAdmin
      .from('event_attendees')
      .insert({ event_id: oppId, user_id: left.id, status: 'left' });

    const { token } = await mintCheckInToken(left.id, oppId);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('is idempotent: re-checking an attended attendee returns 200', async () => {
    const organizer = await createUser('authenticated');
    const admin = await createUser('admin');
    cleanupUserIds.push(organizer.id, admin.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    const { token } = await mintCheckInToken(organizer.id, oppId);

    const first = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: { token },
    });
    expect(first.statusCode).toBe(200);

    const second = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: { token },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().attendee.status).toBe('attended');
  });

  it('returns 401 with no Bearer', async () => {
    const organizer = await createUser('authenticated');
    cleanupUserIds.push(organizer.id);

    const oppId = await createOpportunityFor(organizer.id);
    cleanupOpportunityIds.push(oppId);

    const { token } = await mintCheckInToken(organizer.id, oppId);

    const res = await app.inject({
      method: 'POST',
      url: `/opportunities/${oppId}/check-in`,
      payload: { token },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST /opportunities sets created_by from req.user.id and creates attendee row', async () => {
    const user = await createUser('authenticated');
    cleanupUserIds.push(user.id);

    const res = await app.inject({
      method: 'POST',
      url: '/opportunities',
      headers: { authorization: `Bearer ${user.bearer}` },
      payload: {
        title: 'User-created event',
        city: 'Kyiv',
        location_lat: 50.45,
        location_lng: 30.52,
        start_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        duration_min: 90,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    cleanupOpportunityIds.push(created.id);
    expect(created.created_by).toBe(user.id);

    const { data: attendee } = await supabaseAdmin
      .from('event_attendees')
      .select('user_id, status')
      .eq('event_id', created.id)
      .eq('user_id', user.id)
      .maybeSingle();
    expect(attendee?.status).toBe('joining');
  });

  it('POST /admin/opportunities honors created_by override', async () => {
    const admin = await createUser('admin');
    const veteran = await createUser('authenticated');
    cleanupUserIds.push(admin.id, veteran.id);

    const res = await app.inject({
      method: 'POST',
      url: '/admin/opportunities',
      headers: { authorization: `Bearer ${admin.bearer}` },
      payload: {
        title: 'Admin-created on behalf of veteran',
        city: 'Kyiv',
        location_lat: 50.45,
        location_lng: 30.52,
        start_at: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
        duration_min: 90,
        created_by: veteran.id,
      },
    });
    expect(res.statusCode).toBe(201);
    const created = res.json();
    cleanupOpportunityIds.push(created.id);
    expect(created.created_by).toBe(veteran.id);

    // Veteran (not the admin) is the auto-attendee.
    const { data: vetAttendee } = await supabaseAdmin
      .from('event_attendees')
      .select('user_id')
      .eq('event_id', created.id)
      .eq('user_id', veteran.id)
      .maybeSingle();
    expect(vetAttendee?.user_id).toBe(veteran.id);

    const { data: adminAttendee } = await supabaseAdmin
      .from('event_attendees')
      .select('user_id')
      .eq('event_id', created.id)
      .eq('user_id', admin.id)
      .maybeSingle();
    expect(adminAttendee).toBeNull();
  });
});
