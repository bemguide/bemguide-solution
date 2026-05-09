// Auth helpers for Gemini and DB-mutating edge functions. Functions are deployed
// with --no-verify-jwt; we enforce auth here so the public URL is not free Gemini.

import { env } from "./env.ts";

/**
 * Confirm the request carries `Authorization: Bearer <internal-secret>` where the
 * accepted internal secrets are: VERCEL_CRON_SECRET (preferred — we generated and
 * pushed it ourselves so digests always match) or the runtime SUPABASE_SERVICE_ROLE_KEY
 * (less reliable: Supabase rotates it independently of what's in user's .env.local).
 */
export function isServiceCaller(req: Request): boolean {
  const got = req.headers.get("authorization") ?? "";
  if (!got.startsWith("Bearer ")) return false;
  const token = got.slice("Bearer ".length).trim();
  if (!token) return false;
  return token === env.cronSecret() || token === env.serviceRoleKey();
}

/**
 * Confirm the request carries the cron secret in either `x-cron-secret` or
 * `Authorization: Bearer <secret>` (Vercel cron uses the latter).
 */
export function isCronCaller(req: Request): boolean {
  const fromHeader = req.headers.get("x-cron-secret");
  if (fromHeader && fromHeader === env.cronSecret()) return true;
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ") && auth.slice(7).trim() === env.cronSecret()) return true;
  return false;
}
