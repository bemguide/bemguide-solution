import { supabaseAdmin, supabaseAsUser, type DbClient } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import type { Database } from '../types/supabase.generated.js';

export type UserRow = Database['public']['Tables']['users']['Row'];
export type UserInsert = Database['public']['Tables']['users']['Insert'];
export type UserUpdate = Database['public']['Tables']['users']['Update'];

// Q1–Q12 onboarding fields. Email/id come from auth.users and are not editable here.
// telegram_user_id has its own dedicated endpoint (one-time-token signed by the bot).
export type OnboardingPatch = Pick<
  UserUpdate,
  | 'city'
  | 'display_name'
  | 'show_name_publicly'
  | 'interests'
  | 'availability'
  | 'schedule_constraints'
  | 'company_preference'
  | 'accessibility_flags'
  | 'triggers_to_avoid'
  | 'veteran_status'
  | 'role_in_group'
  | 'age_range'
  | 'bio'
>;

// Service-role read for /me. The route already auth-checked the token; we just want
// the row by id without depending on RLS (so we never serve a stale 'no row visible'
// when the row exists but the token client lost context).
export async function getById(id: string): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin.from('users').select('*').eq('id', id).maybeSingle();
  if (error) throw AppError.upstream('Failed to load user', error.message);
  return data;
}

// Find-by-telegram-id, used by POST /auth/telegram to decide create-or-reuse.
export async function getByTelegramId(telegramUserId: number): Promise<UserRow | null> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('*')
    .eq('telegram_user_id', telegramUserId)
    .maybeSingle();
  if (error) throw AppError.upstream('Failed to load user by telegram id', error.message);
  return data;
}

// Insert with a richer initial set — used when the Mini App is the first
// contact point (we know first_name and the TG id from initData).
export async function insertOnTelegramAuth(
  id: string,
  email: string,
  telegramUserId: number,
  displayName: string | null,
): Promise<UserRow> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .insert({
      id,
      email,
      telegram_user_id: telegramUserId,
      display_name: displayName,
    })
    .select('*')
    .single();

  if (error || !data) {
    if (error && /duplicate key|unique/i.test(error.message)) {
      // Race: another concurrent request already created this row.
      throw AppError.conflict('User already exists');
    }
    throw AppError.upstream('Failed to create user from Telegram', error?.message);
  }
  return data;
}

// Used by POST /opportunities/:id/rsvp when the request includes a display_name
// and the user currently has none. Idempotent: passing a non-null name when
// one already exists is a no-op.
export async function maybeSetDisplayName(
  accessToken: string,
  userId: string,
  displayName: string | null | undefined,
): Promise<void> {
  if (!displayName) return;
  const current = await getById(userId);
  if (current?.display_name) return;
  // user-token client → RLS self_update.
  const client = supabaseAsUser(accessToken);
  const { error } = await client
    .from('users')
    .update({ display_name: displayName })
    .eq('id', userId);
  if (error) throw AppError.upstream('Failed to set display_name', error.message);
}

// User-token client. Hits RLS users_self_update — the access token's auth.uid()
// must equal id. Triggers users_match_recompute when score-relevant columns change.
export async function upsertOnboarding(
  accessToken: string,
  id: string,
  patch: OnboardingPatch,
): Promise<UserRow> {
  const client: DbClient = supabaseAsUser(accessToken);
  const { data, error } = await client
    .from('users')
    .update(patch)
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) throw AppError.upstream('Failed to update profile', error.message);
  if (!data) {
    // Either the row doesn't exist yet or RLS hid it. Both are real bugs in
    // a flow where /auth/register seeds the row, so surface as 404.
    throw AppError.notFound('User profile not found');
  }
  return data;
}

// Service-role update — called from /me/telegram/link after the one-time bot
// token is verified. We bypass RLS so the user's access token alone is enough
// (no need to also speak as the user to satisfy a self_update policy).
export async function updateTelegramLink(id: string, telegramUserId: number): Promise<UserRow> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .update({ telegram_user_id: telegramUserId })
    .eq('id', id)
    .select('*')
    .maybeSingle();

  if (error) {
    if (/duplicate key|unique/i.test(error.message)) {
      throw AppError.conflict('That Telegram account is already linked to a different user');
    }
    throw AppError.upstream('Failed to link Telegram', error.message);
  }
  if (!data) throw AppError.notFound('User profile not found');
  return data;
}
