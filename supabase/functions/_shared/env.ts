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
  // For the event-chat-attach flow: when a user creates an event chat via the
  // Mini App's deep-link, the bot detects the group-add and POSTs the chat_id
  // + invite_url to the auth-backend's /internal/event-rooms/attach endpoint.
  // backendBaseUrl is the Railway URL (e.g. https://...up.railway.app).
  // botInternalSecret is shared with the auth-backend; bot signs the JSON body
  // with HMAC-SHA256 and the backend verifies.
  backendBaseUrl: () => requireEnv("BACKEND_BASE_URL"),
  botInternalSecret: () => requireEnv("BOT_INTERNAL_SECRET"),
};
