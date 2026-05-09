import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';

// Telegram-only auth surface. The two helpers here are the seam between our
// /auth/telegram route and Supabase's auth.users — we still need an
// auth.users row so public.users.id can FK into it. We don't use Supabase's
// password sign-in flow at all; tokens are minted by session.service.ts.

export interface CreatedAuthUser {
  id: string;
  email: string;
}

export async function createUser(email: string, password: string): Promise<CreatedAuthUser> {
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    // No confirmation-email flow exists; we own the entire auth path.
    email_confirm: true,
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
