import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import type { ProfileRow } from './profile.service.js';

export interface PendingPage {
  items: ProfileRow[];
  next_cursor: string | null;
}

export async function listPending(opts: { limit?: number; cursor?: string }): Promise<PendingPage> {
  const limit = Math.min(Math.max(opts.limit ?? 25, 1), 100);

  let query = supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('verification_status', 'pending')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    const decoded = decodeCursor(opts.cursor);
    if (decoded) {
      // Keyset: rows older than (created_at, id)
      query = query.or(
        `created_at.lt.${decoded.created_at},and(created_at.eq.${decoded.created_at},id.lt.${decoded.id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw AppError.upstream('Failed to list pending', error.message);
  const rows = data ?? [];

  let next_cursor: string | null = null;
  let items = rows;
  if (rows.length > limit) {
    items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    next_cursor = encodeCursor({ created_at: last.created_at, id: last.id });
  }
  return { items, next_cursor };
}

export async function approve(profileId: string, adminId: string): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      verification_status: 'approved',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: null,
    })
    .eq('id', profileId)
    .select('*')
    .maybeSingle();

  if (error) throw AppError.upstream('Failed to approve profile', error.message);
  if (!data) throw AppError.notFound('Profile not found');
  return data;
}

export async function reject(
  profileId: string,
  adminId: string,
  reason: string,
): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .update({
      verification_status: 'rejected',
      reviewed_by: adminId,
      reviewed_at: new Date().toISOString(),
      rejection_reason: reason,
    })
    .eq('id', profileId)
    .select('*')
    .maybeSingle();

  if (error) throw AppError.upstream('Failed to reject profile', error.message);
  if (!data) throw AppError.notFound('Profile not found');
  return data;
}

function encodeCursor(c: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

function decodeCursor(c: string): { created_at: string; id: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (typeof parsed?.created_at === 'string' && typeof parsed?.id === 'string') return parsed;
    return null;
  } catch {
    return null;
  }
}
