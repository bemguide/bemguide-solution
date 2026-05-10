// Server-only env helpers for Supabase Edge Functions (Deno).
// Each helper throws synchronously if a required key is missing.

export function requireEnv(key: string): string {
  const v = Deno.env.get(key);
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
}

export const env = {
  supabaseUrl: () => requireEnv("SUPABASE_URL"),
  serviceRoleKey: () => requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
  geminiKey: () => requireEnv("GEMINI_API_KEY"),
  tgBotToken: () => requireEnv("TELEGRAM_BOT_TOKEN"),
  tgBotUsername: () => requireEnv("TELEGRAM_BOT_USERNAME"),
  tgWebhookSecret: () => requireEnv("TELEGRAM_WEBHOOK_SECRET"),
  // Trailing-slash-tolerant: callers concatenate `${APP_URL}/m/...`,
  // so a stored value like `https://example.com/` would otherwise
  // produce `https://example.com//m/onboarding`. Browsers usually
  // normalise `//` in the path, but Telegram Mini App's URL allowlist
  // and our own server-side Link components are stricter — strip it
  // here so every consumer sees the canonical form.
  publicAppUrl: () => requireEnv("NEXT_PUBLIC_APP_URL").replace(/\/+$/, ""),
  cronSecret: () => requireEnv("VERCEL_CRON_SECRET"),
};
