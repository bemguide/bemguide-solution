// Print the current Telegram webhook config (for debugging).

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing");

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/getWebhookInfo`);
  const json = await res.json();
  console.log(JSON.stringify(json, null, 2));
}

main();
