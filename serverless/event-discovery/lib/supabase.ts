import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Opportunity } from "./types.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) throw new Error("Missing SUPABASE_URL / SUPABASE_SERVICE_KEY");
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}

const DEDUP_LOOKBACK_DAYS = Number(process.env.DEDUP_LOOKBACK_DAYS ?? 7);

const URL_REGEX = /https?:\/\/[^\s)]+/g;

export async function fetchRecentPostUrls(): Promise<Set<string>> {
  const supabase = getSupabase();
  const since = new Date(Date.now() - DEDUP_LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("opportunities")
    .select("organizer_contact")
    .gte("created_at", since);
  if (error) {
    console.error(`Failed to fetch existing post_urls: ${error.message}`);
    return new Set();
  }
  const urls = new Set<string>();
  for (const row of data ?? []) {
    const contact = (row as { organizer_contact: string | null }).organizer_contact;
    if (!contact) continue;
    const matches = contact.match(URL_REGEX);
    if (matches) for (const u of matches) urls.add(u.replace(/[.,)]+$/u, ""));
  }
  return urls;
}

export async function insertOpportunities(opps: Opportunity[]): Promise<{ inserted: number; failed: number }> {
  if (!opps.length) return { inserted: 0, failed: 0 };
  const supabase = getSupabase();
  const { data, error } = await supabase.from("opportunities").insert(opps).select("id");
  if (error) {
    console.error(`Supabase insert error: ${error.message}`);
    return { inserted: 0, failed: opps.length };
  }
  return { inserted: data?.length ?? 0, failed: 0 };
}
