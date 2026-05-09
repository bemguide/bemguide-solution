// Shared helpers for the deno-test eval suites.
// These tests hit the LIVE deployed edge functions, so they require:
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY in env.
// Run: deno test --allow-net --allow-env --env-file=../../../.env.local supabase/functions/_shared/evals

import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
export const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
export const INTERNAL_BEARER =
  Deno.env.get("VERCEL_CRON_SECRET") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

if (!SUPABASE_URL || !SERVICE_ROLE || !INTERNAL_BEARER) {
  throw new Error(
    "evals require SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY + VERCEL_CRON_SECRET (use --env-file=.env.local)",
  );
}

const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1];
export const FN_ROOT = `https://${projectRef}.supabase.co/functions/v1`;

export function admin() {
  return createClient(SUPABASE_URL!, SERVICE_ROLE!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function callFn<T = Record<string, unknown>>(
  name: string,
  body: unknown,
): Promise<{ status: number; json: T }> {
  const res = await fetch(`${FN_ROOT}/${name}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      Authorization: `Bearer ${INTERNAL_BEARER}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: T;
  try {
    json = JSON.parse(text) as T;
  } catch {
    json = text as unknown as T;
  }
  return { status: res.status, json };
}

/** Find seed events filtered by predicate; useful for picking a known set per test. */
export async function findEvents(opts: {
  city?: string;
  identity_tag?: string;
  limit?: number;
}): Promise<{ id: string; slug: string; title: string; city: string }[]> {
  let q = admin()
    .from("events")
    .select("id, slug, title, city, identity_tag")
    .eq("source", "admin_seed")
    .order("start_at", { ascending: true });
  if (opts.city) q = q.eq("city", opts.city);
  if (opts.identity_tag) q = q.eq("identity_tag", opts.identity_tag);
  q = q.limit(opts.limit ?? 10);
  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as { id: string; slug: string; title: string; city: string }[];
}

/** Find a seed ghost veteran matching constraints (used as the "user" in rank tests). */
export async function findGhost(opts: {
  city?: string;
  identity_prefs?: string;
}): Promise<{ id: string; display_name: string; city: string }> {
  let q = admin()
    .from("veterans")
    .select("id, display_name, city, identity_prefs")
    .eq("comfort_notes", "[seed-ghost]");
  if (opts.city) q = q.eq("city", opts.city);
  if (opts.identity_prefs) q = q.eq("identity_prefs", opts.identity_prefs);
  q = q.limit(1);
  const { data, error } = await q;
  if (error) throw error;
  if (!data?.[0]) throw new Error(`no ghost matches ${JSON.stringify(opts)}`);
  return data[0] as { id: string; display_name: string; city: string };
}

/** Insert a temporary veteran with explicit attributes; cleaned up by the test. */
export async function makeTempVeteran(attrs: {
  city: string;
  interests: string[];
  identity_prefs: string;
  accessibility_flags?: string[];
}): Promise<string> {
  const { data, error } = await admin()
    .from("veterans")
    .insert({
      ...attrs,
      accessibility_flags: attrs.accessibility_flags ?? [],
      display_name: "evaltest",
      show_name_publicly: false,
      reminders_enabled: false,
      language: "uk",
      comfort_notes: "[evaltest-temp]",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data!.id;
}

export async function deleteTempVeteran(id: string): Promise<void> {
  await admin().from("veterans").delete().eq("id", id);
}
