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
  publicAppUrl: () => requireEnv("NEXT_PUBLIC_APP_URL"),
  cronSecret: () => requireEnv("VERCEL_CRON_SECRET"),
};
