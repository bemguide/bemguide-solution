import { supabaseAdmin, supabaseAsUser } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import { clampLimit, decodeCursor, encodeCursor } from '../utils/cursor.js';
import type { Database } from '../types/supabase.generated.js';

type InvitationRow = Database['public']['Tables']['event_invitations']['Row'];
type InvitationInsert = Database['public']['Tables']['event_invitations']['Insert'];
type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];

export interface InvitationWithEvent extends InvitationRow {
  opportunities: OpportunityRow | null;
}

export interface InvitationsPage {
  items: InvitationWithEvent[];
  next_cursor: string | null;
}

// User-token client → RLS event_invitations_self_read.
// Sort by created_at desc, id desc.
export async function listForUser(
  accessToken: string,
  opts: { limit?: number; cursor?: string },
): Promise<InvitationsPage> {
  const limit = clampLimit(opts.limit);
  const client = supabaseAsUser(accessToken);

  let query = client
    .from('event_invitations')
    .select('*, opportunities(*)')
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(limit + 1);

  if (opts.cursor) {
    const decoded = decodeCursor<{ ts: string; id: string }>(opts.cursor);
    if (decoded) {
      query = query.or(
        `created_at.lt.${decoded.ts},and(created_at.eq.${decoded.ts},id.lt.${decoded.id})`,
      );
    }
  }

  const { data, error } = await query;
  if (error) throw AppError.upstream('Failed to load invitations', error.message);
  const rows = (data ?? []) as InvitationWithEvent[];

  let next_cursor: string | null = null;
  let items = rows;
  if (rows.length > limit) {
    items = rows.slice(0, limit);
    const last = items[items.length - 1]!;
    next_cursor = encodeCursor({ ts: last.created_at, id: last.id });
  }
  return { items, next_cursor };
}

// PATCH /me/invitations/:id — user-token client updates response + responded_at
// (RLS event_invitations_self_update). On 'accepted' we also insert into
// event_attendees via service role (RLS would block self-insert without an
// explicit policy, and the trigger event_attendees_create_room runs either way).
export async function respond(
  accessToken: string,
  userId: string,
  invitationId: string,
  response: 'accepted' | 'declined',
): Promise<{ invitation: InvitationRow; attended: boolean }> {
  const client = supabaseAsUser(accessToken);

  const { data: invitation, error: updateErr } = await client
    .from('event_invitations')
    .update({ response, responded_at: new Date().toISOString() })
    .eq('id', invitationId)
    .select('*')
    .maybeSingle();

  if (updateErr) throw AppError.upstream('Failed to record response', updateErr.message);
  if (!invitation) throw AppError.notFound('Invitation not found');

  if (response !== 'accepted') {
    return { invitation, attended: false };
  }

  // Service-role insert into attendees. The (event_id, user_id) primary key
  // makes this idempotent on duplicate accepts. Trigger creates event_rooms.
  const { error: insertErr } = await supabaseAdmin.from('event_attendees').insert({
    event_id: invitation.event_id,
    user_id: userId,
    invitation_id: invitation.id,
    show_name_publicly: false,
  });

  if (insertErr && !/duplicate key|already exists/i.test(insertErr.message)) {
    throw AppError.upstream('Failed to mark attendance', insertErr.message);
  }
  return { invitation, attended: true };
}

// ──────────────────────────────────────────────────────────────────────────
// Worker helpers (service role only)
// ──────────────────────────────────────────────────────────────────────────

// Insert a batch of invitations from event_matches selection. Sticky-decline
// is enforced by the unique (event_id, user_id) constraint — duplicate rows
// for users who previously declined will fail and be skipped.
export async function insertForDispatch(rows: InvitationInsert[]): Promise<InvitationRow[]> {
  if (rows.length === 0) return [];
  // upsert with ignoreDuplicates so the unique-key violation isn't fatal —
  // we just skip users who already have an invitation row.
  const { data, error } = await supabaseAdmin
    .from('event_invitations')
    .upsert(rows, { onConflict: 'event_id,user_id', ignoreDuplicates: true })
    .select('*');
  if (error) throw AppError.upstream('Failed to insert invitations', error.message);
  return data ?? [];
}

export async function listPendingDispatch(limit: number): Promise<InvitationWithEvent[]> {
  // Matches the partial index event_invitations_pending_dispatch_idx
  // (where delivery_status = 'pending').
  const { data, error } = await supabaseAdmin
    .from('event_invitations')
    .select('*, opportunities(*)')
    .eq('delivery_status', 'pending')
    .lte('scheduled_for', new Date().toISOString())
    .order('scheduled_for', { ascending: true })
    .limit(limit);

  if (error) throw AppError.upstream('Failed to load pending invitations', error.message);
  return (data ?? []) as InvitationWithEvent[];
}

export async function markSent(
  invitationId: string,
  channelExternalId: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('event_invitations')
    .update({
      delivery_status: 'sent',
      sent_at: new Date().toISOString(),
      channel_external_id: channelExternalId,
    })
    .eq('id', invitationId);
  if (error) throw AppError.upstream('Failed to mark invitation sent', error.message);
}

export async function markFailed(invitationId: string, reason: string): Promise<void> {
  // Intentionally NOT incrementing retry_count via SQL — we'd need an RPC for
  // an atomic increment. Worker reads current, increments locally, writes back.
  const { data: row, error: readErr } = await supabaseAdmin
    .from('event_invitations')
    .select('retry_count')
    .eq('id', invitationId)
    .maybeSingle();
  if (readErr) throw AppError.upstream('Failed to read invitation', readErr.message);
  const next = (row?.retry_count ?? 0) + 1;

  const { error } = await supabaseAdmin
    .from('event_invitations')
    .update({ delivery_status: 'failed', failure_reason: reason, retry_count: next })
    .eq('id', invitationId);
  if (error) throw AppError.upstream('Failed to mark invitation failed', error.message);
}
