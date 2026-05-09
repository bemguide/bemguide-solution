import { supabaseAdmin, supabaseAsUser } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import type { Database } from '../types/supabase.generated.js';

type RoomRow = Database['public']['Tables']['event_rooms']['Row'];

// User-token client → RLS event_rooms_attendees_read.
// Returns null if not an attendee (RLS hides the row).
export async function getForEvent(accessToken: string, eventId: string): Promise<RoomRow | null> {
  const client = supabaseAsUser(accessToken);
  const { data, error } = await client
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
