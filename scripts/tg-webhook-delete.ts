// Detach the bot webhook (useful when switching environments).

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!BOT_TOKEN) throw new Error("TELEGRAM_BOT_TOKEN missing");

async function main() {
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/deleteWebhook`, {
    method: "POST",
  });
  const json = await res.json();
  console.log(JSON.stringify(json));
}

main();
