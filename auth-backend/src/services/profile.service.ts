import { supabaseAdmin, supabaseAsUser, type DbClient } from '../config/supabase.js';
import { AppError } from '../utils/errors.js';
import type { Database } from '../types/supabase.generated.js';

export type ProfileRow = Database['public']['Tables']['profiles']['Row'];
export type ProfileInsert = Database['public']['Tables']['profiles']['Insert'];

export async function insertProfile(row: ProfileInsert): Promise<ProfileRow> {
  const { data, error } = await supabaseAdmin.from('profiles').insert(row).select('*').single();

  if (error || !data) {
    throw AppError.upstream('Failed to insert profile', error?.message);
  }
  return data;
}

export async function getProfileById(id: string): Promise<ProfileRow | null> {
  const { data, error } = await supabaseAdmin
    .from('profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw AppError.upstream('Failed to load profile', error.message);
  return data;
}

export async function getProfileForOwner(client: DbClient, id: string): Promise<ProfileRow | null> {
  const { data, error } = await client.from('profiles').select('*').eq('id', id).maybeSingle();
  if (error) throw AppError.upstream('Failed to load profile', error.message);
  return data;
}

export function clientForUser(accessToken: string): DbClient {
  return supabaseAsUser(accessToken);
}
