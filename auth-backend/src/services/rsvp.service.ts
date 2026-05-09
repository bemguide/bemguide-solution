import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import { maybeSetDisplayName } from './users.service.js';
import type { Database } from '../types/supabase.generated.js';

type InvitationRow = Database['public']['Tables']['event_invitations']['Row'];
type AttendeeRow = Database['public']['Tables']['event_attendees']['Row'];
type RoomRow = Database['public']['Tables']['event_rooms']['Row'];

export interface RsvpResult {
  invitation: InvitationRow;
  attendee: AttendeeRow | null;
  room: RoomRow | null;
}

export interface RsvpInput {
  response: 'accepted' | 'declined';
  invitation_id?: string;
  display_name?: string | null;
  show_name_publicly?: boolean;
}

// POST /opportunities/:id/rsvp — combined upsert.
//
// 1. Optionally seed users.display_name (via user-token client → RLS self_update).
// 2. Upsert event_invitations (event_id, user_id) with response + responded_at.
//    Channel='inapp' for fresh rows (the user came in via the Mini App, not a
//    pre-dispatched Telegram invite). When a pre-existing pending invite is
//    being responded to, we keep its channel — the on-conflict update only
//    touches response columns.
// 3. If accepted: upsert event_attendees with show_name_publicly. Trigger
//    event_attendees_create_room runs on first INSERT and creates the room.
// 4. If declined: set existing attendee row's status='left' (don't delete —
//    keeps audit trail and preserves event_rooms per contract).
// 5. Return invitation + attendee + room.
//
// Refuses rsvp once start_at is in the past (409 event_started).
export async function rsvpToOpportunity(
  accessToken: string,
  userId: string,
  opportunityId: string,
  input: RsvpInput,
): Promise<RsvpResult> {
  const { data: opp, error: oppErr } = await supabaseAdmin
    .from('opportunities')
    .select('id, start_at')
    .eq('id', opportunityId)
    .maybeSingle();
  if (oppErr) throw AppError.upstream('Failed to load opportunity', oppErr.message);
  if (!opp) throw AppError.notFound('Opportunity not found', 'opportunity_not_found');

  if (opp.start_at) {
    const startMs = Date.parse(opp.start_at.endsWith('Z') ? opp.start_at : `${opp.start_at}Z`);
    if (Number.isFinite(startMs) && startMs < Date.now()) {
      throw AppError.conflict('Event already started', 'event_started');
    }
  }

  await maybeSetDisplayName(accessToken, userId, input.display_name ?? null);

  const nowIso = new Date().toISOString();

  // Look for an existing invitation row first — its presence tells us whether
  // we need to insert or update, and what channel to preserve.
  const { data: existingInv, error: invReadErr } = await supabaseAdmin
    .from('event_invitations')
    .select('*')
    .eq('event_id', opportunityId)
    .eq('user_id', userId)
    .maybeSingle();
  if (invReadErr) throw AppError.upstream('Failed to load invitation', invReadErr.message);

  let invitation: InvitationRow;
  if (existingInv) {
    // Sticky decline: never let a 'declined' row flip back to 'accepted'.
    if (existingInv.response === 'declined' && input.response === 'accepted') {
      throw AppError.conflict('Already declined', 'already_rsvped');
    }
    const { data, error } = await supabaseAdmin
      .from('event_invitations')
      .update({ response: input.response, responded_at: nowIso })
      .eq('id', existingInv.id)
      .select('*')
      .single();
    if (error || !data) throw AppError.upstream('Failed to update invitation', error?.message);
    invitation = data;
  } else {
    const { data, error } = await supabaseAdmin
      .from('event_invitations')
      .insert({
        event_id: opportunityId,
        user_id: userId,
        score_at_invite: 0,
        channel: 'inapp',
        scheduled_for: nowIso,
        delivery_status: 'sent',
        sent_at: nowIso,
        response: input.response,
        responded_at: nowIso,
      })
      .select('*')
      .single();
    if (error || !data) throw AppError.upstream('Failed to create invitation', error?.message);
    invitation = data;
  }

  let attendee: AttendeeRow | null = null;

  if (input.response === 'accepted') {
    const showName = input.show_name_publicly ?? false;
    const linkedInvitationId = input.invitation_id ?? invitation.id;
    const { data, error } = await supabaseAdmin
      .from('event_attendees')
      .upsert(
        {
          event_id: opportunityId,
          user_id: userId,
          invitation_id: linkedInvitationId,
          status: 'joining',
          show_name_publicly: showName,
        },
        { onConflict: 'event_id,user_id' },
      )
      .select('*')
      .single();
    if (error || !data) throw AppError.upstream('Failed to upsert attendee', error?.message);
    attendee = data;
  } else {
    // declined: mark any existing attendee as 'left' (don't delete; the
    // contract calls this out — preserves event_rooms and audit history).
    const { data, error } = await supabaseAdmin
      .from('event_attendees')
      .update({ status: 'left' })
      .eq('event_id', opportunityId)
      .eq('user_id', userId)
      .select('*')
      .maybeSingle();
    if (error) throw AppError.upstream('Failed to mark attendee left', error.message);
    attendee = data;
  }

  // Room — only exists for events that had at least one accepted attendee
  // (the trigger creates the row on event_attendees INSERT). Service-role
  // read because the user might not yet satisfy attendees-read RLS by the
  // time the trigger has fired.
  const { data: room, error: roomErr } = await supabaseAdmin
    .from('event_rooms')
    .select('*')
    .eq('event_id', opportunityId)
    .maybeSingle();
  if (roomErr) throw AppError.upstream('Failed to load room', roomErr.message);

  return { invitation, attendee, room };
}
