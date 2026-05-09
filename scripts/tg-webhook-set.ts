// Register the bot webhook with Telegram. Idempotent: re-run after every deploy
// of the bot function. Uses TELEGRAM_WEBHOOK_SECRET so the bot rejects spoofed POSTs.

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
const SUPABASE_URL = process.env.SUPABASE_URL;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing");
if (!WEBHOOK_SECRET) throw new Error("TELEGRAM_WEBHOOK_SECRET missing");
if (!SUPABASE_URL) throw new Error("SUPABASE_URL missing");

const projectRef = SUPABASE_URL.match(/https:\/\/([^.]+)\./)?.[1];
const webhookUrl = `https://${projectRef}.supabase.co/functions/v1/bot`;

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: WEBHOOK_SECRET,
      allowed_updates: ["message", "callback_query", "inline_query"],
      drop_pending_updates: false,
    }),
  });
  const json = await res.json();
  if (!json.ok) {
    console.error("Failed to set webhook:", json);
    process.exit(1);
  }
  console.log(`✓ Webhook set → ${webhookUrl}`);
  console.log(`  description: ${json.description ?? "ok"}`);
}

main();
