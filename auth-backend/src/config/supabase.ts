import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from './env.js';
import type { Database } from '../types/supabase.generated.js';

export type DbClient = SupabaseClient<Database>;

// Server-only client. Uses the service role key, bypasses RLS, and never
// persists or refreshes a session (we run statelessly per request).
export const supabaseAdmin: DbClient = createClient<Database>(
  env.SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  },
);

// Per-request client carrying a user's access token. RLS is enforced as the
// signed-in user — used when we deliberately want to test what the user can see.
export function supabaseAsUser(accessToken: string): DbClient {
  return createClient<Database>(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  });
}
