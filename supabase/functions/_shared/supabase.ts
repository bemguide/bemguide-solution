// Service-role Supabase client. Only call from edge functions that have already
// verified the caller (initData, cron secret, or webhook secret) — this client
// bypasses RLS.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env.ts";

let client: SupabaseClient | undefined;

export function adminClient(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl(), env.serviceRoleKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}
