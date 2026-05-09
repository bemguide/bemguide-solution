// Curl each deployed Supabase Edge Function and verify each is reachable +
// authenticated. Now that the M5/M6/M10/M11 implementations have real auth
// rules, we use VERCEL_CRON_SECRET as the bearer (the canonical internal one)
// and accept any non-5xx response as "alive".
//
// Usage: pnpm fn:verify

const FUNCTIONS = [
  // Each entry: name + how to call (GET/POST + body) + expected non-5xx pattern.
  { name: "bot", method: "POST", body: "{}", expect: "ignore-status" }, // bot rejects without TG secret → 403
  { name: "rsvp-create", method: "POST", body: "{}" }, // 400 missing fields = alive
  { name: "ics-generate", method: "GET" }, // 400 missing rsvp_id+token = alive
  { name: "notify-scheduler", method: "POST", body: "{}" }, // 200 = alive
  { name: "gemini-rank", method: "POST", body: "{}" }, // 400 invalid input = alive
  { name: "gemini-parse-event", method: "POST", body: "{}" }, // 400 missing raw_text = alive
  { name: "gemini-moderate", method: "POST", body: "{}" }, // 400 missing event_id = alive
  { name: "gemini-copy", method: "POST", body: "{}" }, // 400 missing kind = alive
] as const;

async function main() {
  const url = process.env.SUPABASE_URL;
  const cron = process.env.VERCEL_CRON_SECRET;
  if (!url) throw new Error("SUPABASE_URL missing");
  if (!cron) throw new Error("VERCEL_CRON_SECRET missing");

  const projectRef = url.match(/https:\/\/([^.]+)\./)?.[1];
  const fnRoot = `https://${projectRef}.supabase.co/functions/v1`;
  let ok = 0;
  let dead = 0;

  for (const fn of FUNCTIONS) {
    const endpoint = `${fnRoot}/${fn.name}`;
    try {
      const res = await fetch(endpoint, {
        method: fn.method,
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${cron}`,
        },
        body: fn.method === "POST" ? (fn.body ?? "{}") : undefined,
      });
      // Anything non-5xx means the function is deployed and responding.
      if (res.status < 500) {
        console.log(`✓ ${fn.name} — ${res.status}`);
        ok++;
      } else {
        console.log(`✗ ${fn.name} — ${res.status}`);
        dead++;
      }
    } catch (e) {
      console.log(`✗ ${fn.name} — error: ${(e as Error).message}`);
      dead++;
    }
  }
  console.log(`\n${ok}/${FUNCTIONS.length} reachable, ${dead} unreachable`);
  process.exit(dead > 0 ? 1 : 0);
}

main();
