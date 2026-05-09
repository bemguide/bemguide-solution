// Curl each deployed Supabase Edge Function and verify it returns the stub envelope.
//
// Usage: pnpm exec tsx --env-file=.env.local scripts/verify-functions.ts

const FUNCTIONS = [
  "bot",
  "rsvp-create",
  "ics-generate",
  "notify-scheduler",
  "gemini-rank",
  "gemini-parse-event",
  "gemini-moderate",
  "gemini-copy",
] as const;

const url = process.env.SUPABASE_URL;
const anonKey = process.env.SUPABASE_ANON_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url) throw new Error("SUPABASE_URL missing");
if (!anonKey) {
  throw new Error("Need SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY to call edge functions");
}
const projectRef = url.match(/https:\/\/([^.]+)\./)?.[1];

async function main() {
  let ok = 0;
  let fail = 0;
  for (const fn of FUNCTIONS) {
    const endpoint = `https://${projectRef}.supabase.co/functions/v1/${fn}`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${anonKey}`,
        },
      });
      const json: { ok?: boolean; fn?: string } = await res.json();
      if (res.status === 200 && json.ok && json.fn === fn) {
        console.log(`✓ ${fn} — 200`);
        ok++;
      } else {
        console.log(`✗ ${fn} — ${res.status} ${JSON.stringify(json)}`);
        fail++;
      }
    } catch (e) {
      console.log(`✗ ${fn} — error: ${(e as Error).message}`);
      fail++;
    }
  }
  console.log(`\n${ok}/${FUNCTIONS.length} ok, ${fail} failed`);
  process.exit(fail > 0 ? 1 : 0);
}

main();
