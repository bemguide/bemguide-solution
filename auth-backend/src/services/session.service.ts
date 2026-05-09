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
