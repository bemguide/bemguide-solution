import { supabaseAdmin } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import type { Database } from '../types/supabase.generated.js';

type AttendeeRow = Database['public']['Tables']['event_attendees']['Row'];
type AttendeeStatus = Database['public']['Enums']['attendee_status'];

const ALLOWED_TRANSITIONS: Record<AttendeeStatus, AttendeeStatus[]> = {
  joining: ['attended', 'no_show', 'left'],
  attended: [],
  no_show: [],
  left: [],
};

// User-driven status update. Currently only meaningful for `left` (user pulled
// out). `attended` / `no_show` are typically organizer-set; the route allows
// them via the same endpoint for now and we can split later if needed.
//
// Service-role read + write — replaces the user-token + RLS path (HS256 session
// JWTs aren't PostgREST-verifiable). The explicit (event_id, user_id) filter
// scopes the read to the caller's row, same as the prior RLS contract.
export async function updateStatus(
  userId: string,
  eventId: string,
  next: AttendeeStatus,
): Promise<AttendeeRow> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('event_attendees')
    .select('*')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw AppError.upstream('Failed to read attendance', readErr.message);
  if (!current) throw AppError.notFound('Attendance not found');

  if (current.status === next) return current;
  if (!ALLOWED_TRANSITIONS[current.status].includes(next)) {
    throw AppError.validation(`Cannot transition from ${current.status} to ${next}`);
  }

  // No self-update RLS policy on event_attendees — service role does the write.
  const { data, error } = await supabaseAdmin
    .from('event_attendees')
    .update({ status: next })
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .select('*')
    .maybeSingle();

  if (error) throw AppError.upstream('Failed to update attendance', error.message);
  if (!data) throw AppError.notFound('Attendance not found');
  return data;
}

export async function listByEvent(eventId: string): Promise<AttendeeRow[]> {
  const { data, error } = await supabaseAdmin
    .from('event_attendees')
    .select('*')
    .eq('event_id', eventId)
    .order('joined_at', { ascending: true });
  if (error) throw AppError.upstream('Failed to list attendees', error.message);
  return data ?? [];
}

type OpportunityRow = Database['public']['Tables']['opportunities']['Row'];

export interface UpcomingAttendance {
  attendee: AttendeeRow;
  opportunity: OpportunityRow;
}

// GET /me/upcoming — events the user has accepted that haven't started yet
// (or have no start_at, treating "always-on" opportunities as upcoming).
export async function listUpcomingForUser(
  accessToken: string,
  userId: string,
): Promise<UpcomingAttendance[]> {
  void accessToken; // Service-role read; the userId filter scopes the result.
  const { data, error } = await supabaseAdmin
    .from('event_attendees')
    .select('*, opportunities!inner(*)')
    .eq('user_id', userId)
    .in('status', ['joining', 'attended']);
  if (error) throw AppError.upstream('Failed to load upcoming', error.message);

  type Joined = AttendeeRow & { opportunities: OpportunityRow };
  const rows = (data ?? []) as unknown as Joined[];

  const now = Date.now();
  const upcoming: UpcomingAttendance[] = [];
  for (const row of rows) {
    const startAt = row.opportunities.start_at;
    if (startAt) {
      const ts = Date.parse(startAt.endsWith('Z') ? startAt : `${startAt}Z`);
      if (Number.isFinite(ts) && ts < now) continue;
    }
    upcoming.push({
      attendee: {
        event_id: row.event_id,
        invitation_id: row.invitation_id,
        joined_at: row.joined_at,
        show_name_publicly: row.show_name_publicly,
        status: row.status,
        user_id: row.user_id,
      },
      opportunity: row.opportunities,
    });
  }
  // Sort: nearest start first; null start_at last.
  upcoming.sort((a, b) => {
    const ta = a.opportunity.start_at ? Date.parse(`${a.opportunity.start_at}Z`) : Infinity;
    const tb = b.opportunity.start_at ? Date.parse(`${b.opportunity.start_at}Z`) : Infinity;
    return ta - tb;
  });
  return upcoming;
}

// Public count + opt-in display names. A name appears only when both
// event_attendees.show_name_publicly AND users.show_name_publicly are true.
const NAMES_VISIBLE_MAX_PUBLIC = 12;

export async function getPublicAttendeeStats(
  eventId: string,
): Promise<{ count: number; names_visible: string[] }> {
  const { data, error } = await supabaseAdmin
    .from('event_attendees')
    .select('show_name_publicly, users:user_id(display_name, show_name_publicly)')
    .eq('event_id', eventId)
    .in('status', ['joining', 'attended']);
  if (error) throw AppError.upstream('Failed to load attendees', error.message);

  type Row = {
    show_name_publicly: boolean;
    users: { display_name: string | null; show_name_publicly: boolean } | null;
  };
  const rows = (data ?? []) as unknown as Row[];

  const names: string[] = [];
  for (const row of rows) {
    if (names.length >= NAMES_VISIBLE_MAX_PUBLIC) break;
    if (row.show_name_publicly && row.users?.show_name_publicly && row.users.display_name) {
      names.push(row.users.display_name);
    }
  }
  return { count: rows.length, names_visible: names };
}

// PATCH /opportunities/:id/attendee/show-name. The user must already be an
// attendee (we don't auto-create here — that's POST /…/rsvp's job).
export async function setShowNamePublicly(
  userId: string,
  eventId: string,
  show: boolean,
): Promise<{ status: AttendeeStatus; show_name_publicly: boolean }> {
  // Read current via service role — the user might not have RLS access if
  // their token's auth.uid() differs (defensive).
  const { data: current, error: readErr } = await supabaseAdmin
    .from('event_attendees')
    .select('status')
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .maybeSingle();
  if (readErr) throw AppError.upstream('Failed to read attendance', readErr.message);
  if (!current) throw AppError.forbidden('Not an attendee of this event', 'not_attendee');

  const { data, error } = await supabaseAdmin
    .from('event_attendees')
    .update({ show_name_publicly: show })
    .eq('event_id', eventId)
    .eq('user_id', userId)
    .select('status, show_name_publicly')
    .maybeSingle();
  if (error) throw AppError.upstream('Failed to update show_name', error.message);
  if (!data) throw AppError.forbidden('Not an attendee of this event', 'not_attendee');
  return data;
}
