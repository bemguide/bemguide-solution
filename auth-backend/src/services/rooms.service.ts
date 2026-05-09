import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import type { Database } from '../types/supabase.generated.js';

type RoomRow = Database['public']['Tables']['event_rooms']['Row'];

// Service-role read with explicit attendee check. Replaces the old user-token
// + RLS event_rooms_attendees_read path, since our HS256 session JWTs are not
// PostgREST-verifiable (project signs with ES256). Returns null if the user
// isn't an active attendee — same surface contract the route relies on to 403.
export async function getForEvent(userId: string, eventId: string): Promise<RoomRow | null> {
  const { data: attendee, error: attErr } = await supabaseAdmin
    .from('event_attendees')
    .select('user_id')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .in('status', ['joining', 'attended'])
    .maybeSingle();
  if (attErr) throw AppError.upstream('Failed to verify attendance', attErr.message);
  if (!attendee) return null;

  const { data, error } = await supabaseAdmin
    .from('event_rooms')
    .select('*')
    .eq('event_id', eventId)
    .maybeSingle();
  if (error) throw AppError.upstream('Failed to load room', error.message);
  return data;
}

// ──────────────────────────────────────────────────────────────────────────
// Worker helpers (service role)
// ──────────────────────────────────────────────────────────────────────────

// Matches the partial index event_rooms_pending_provision_idx (chat_provider IS NULL).
export async function listPendingProvision(limit: number): Promise<RoomRow[]> {
  const { data, error } = await supabaseAdmin
    .from('event_rooms')
    .select('*')
    .is('chat_provider', null)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw AppError.upstream('Failed to list pending rooms', error.message);
  return data ?? [];
}

export async function markProvisioned(
  eventId: string,
  fields: { chat_provider: string; chat_external_id: string; chat_invite_url: string },
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('event_rooms')
    .update({
      chat_provider: fields.chat_provider,
      chat_external_id: fields.chat_external_id,
      chat_invite_url: fields.chat_invite_url,
      chat_created_at: new Date().toISOString(),
    })
    .eq('event_id', eventId);
  if (error) throw AppError.upstream('Failed to mark room provisioned', error.message);
}
