import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';

export interface CreatedAuthUser {
  id: string;
  email: string;
}

export async function createUser(email: string, password: string): Promise<CreatedAuthUser> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: false,
  });

  if (error || !data.user) {
    if (error && /already registered|already exists/i.test(error.message)) {
      throw AppError.conflict('Email is already registered');
    }
    throw AppError.upstream('Failed to create user', error?.message);
  }

  return { id: data.user.id, email: data.user.email ?? email };
}

export async function deleteUser(userId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    // Best-effort cleanup; surface as upstream so callers can decide whether to bail.
    throw AppError.upstream('Failed to delete user', error.message);
  }
}

export interface SupabaseSession {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  token_type: 'bearer';
}

function toSession(session: {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
}): SupabaseSession {
  return {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_at: session.expires_at ?? 0,
    token_type: 'bearer',
  };
}

export async function signInWithPassword(
  email: string,
  password: string,
): Promise<{ userId: string; email: string; session: SupabaseSession }> {
  const { data, error } = await supabaseAdmin.auth.signInWithPassword({ email, password });
  if (error || !data.session || !data.user) {
    // Generic message: do not leak whether the email exists.
    throw AppError.unauthenticated('Invalid email or password');
  }
  return {
    userId: data.user.id,
    email: data.user.email ?? email,
    session: toSession(data.session),
  };
}

export async function refreshSession(refreshToken: string): Promise<SupabaseSession> {
  const { data, error } = await supabaseAdmin.auth.refreshSession({ refresh_token: refreshToken });
  if (error || !data.session) {
    throw AppError.unauthenticated('Invalid or expired refresh token');
  }
  return toSession(data.session);
}

export async function getUserFromToken(
  accessToken: string,
): Promise<{ id: string; email: string; role?: string } | null> {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);
  if (error || !data.user) return null;
  const role = (data.user.app_metadata as { role?: string } | undefined)?.role;
  return { id: data.user.id, email: data.user.email ?? '', role };
}

export async function signOutAccessToken(accessToken: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.signOut(accessToken);
  if (error) {
    // Token might already be invalid; treat as success for logout idempotency.
    return;
  }
}
