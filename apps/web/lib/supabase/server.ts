// Server-only Supabase client. Uses the service role key — never import this
// from a client component. RLS is bypassed by service role, so we filter by
// status='approved' explicitly when reading public data.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { serverEnv } from "@/lib/env";

let cached: SupabaseClient | undefined;

export function serverSupabase(): SupabaseClient {
  if (!cached) {
    const env = serverEnv();
    cached = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return cached;
}
