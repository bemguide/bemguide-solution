import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

// Mint and verify our own session JWTs (HS256, signed with SESSION_JWT_SECRET).
//
// We do NOT try to issue Supabase-compatible tokens. Newer Supabase projects
// (including ours) sign with ES256 — the private key lives in Supabase's KMS,
// only a JWKS-published public key is available to project owners. Without
// the private key we can't reissue tokens PostgREST would accept; if/when
// we want direct-to-PostgREST, we'd configure PostgREST to trust our JWKS
// instead, or migrate to ES256 + own keypair (see plan).
//
// Tokens we mint will only be validated by THIS backend. That's fine — the
// frontend treats the token as opaque per contract.

const ISSUER = 'auth-backend';
const AUDIENCE = 'mini-app';
// Distinct audience namespaces a check-in QR JWT from a session JWT — both are
// HS256 with SESSION_JWT_SECRET, so the audience claim is what stops one from
// being accepted in the other's verify path.
const CHECK_IN_AUDIENCE = 'check-in';

const secret = (): Uint8Array => new TextEncoder().encode(env.SESSION_JWT_SECRET);

export interface MintedSession {
  token: string;
  expires_at: string; // ISO
  expires_at_unix: number;
}

export async function mintSessionJwt(
  userId: string,
  email: string,
  ttlSeconds: number = env.ACCESS_TOKEN_TTL_SECONDS,
): Promise<MintedSession> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const token = await new SignJWT({ email, role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret());

  return {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    expires_at_unix: exp,
  };
}

// Mint a short-lived check-in QR token. Same secret as session JWTs but a
// distinct `aud` so a leaked check-in token can't be passed to authGuard, and
// vice-versa. Payload carries event_id so the verifier can confirm the QR
// matches the event being scanned without an extra DB lookup.
export async function mintCheckInToken(
  userId: string,
  eventId: string,
  ttlSeconds: number = env.CHECK_IN_TOKEN_TTL_SECONDS,
): Promise<MintedSession> {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSeconds;

  const token = await new SignJWT({ event_id: eventId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(CHECK_IN_AUDIENCE)
    .setSubject(userId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(secret());

  return {
    token,
    expires_at: new Date(exp * 1000).toISOString(),
    expires_at_unix: exp,
  };
}

// Verify a check-in QR token (organizer-side scanner endpoint will call this).
// Throws AppError.unauthenticated/expired on failure; returns the payload on
// success. The audience check rejects session JWTs presented as check-in QRs.
export async function verifyCheckInToken(token: string): Promise<{
  user_id: string;
  event_id: string;
}> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: CHECK_IN_AUDIENCE });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw AppError.unauthenticated('Invalid check-in token (no sub claim)');
    }
    if (typeof payload.event_id !== 'string' || !payload.event_id) {
      throw AppError.unauthenticated('Invalid check-in token (no event_id claim)');
    }
    return { user_id: payload.sub, event_id: payload.event_id };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw AppError.expired('Check-in token expired');
    }
    if (err instanceof joseErrors.JOSEError) {
      throw AppError.unauthenticated('Invalid check-in token');
    }
    throw err;
  }
}

// Used by auth-guard. Returns user id + email + role on success; throws
// AppError.unauthenticated/expired on failure.
export async function verifySessionJwt(token: string): Promise<{
  id: string;
  email: string;
  role: string;
}> {
  try {
    const { payload } = await jwtVerify(token, secret(), { audience: AUDIENCE });
    if (typeof payload.sub !== 'string' || !payload.sub) {
      throw AppError.unauthenticated('Invalid token (no sub claim)');
    }
    const email = typeof payload.email === 'string' ? payload.email : '';
    const role = typeof payload.role === 'string' ? payload.role : 'authenticated';
    return { id: payload.sub, email, role };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      throw AppError.expired();
    }
    if (err instanceof joseErrors.JOSEError) {
      throw AppError.unauthenticated('Invalid token');
    }
    throw err;
  }
}
