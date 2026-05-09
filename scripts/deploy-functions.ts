// Deploy all 8 Supabase Edge Functions + sync secrets.
//
// Usage: pnpm exec tsx --env-file=.env.local scripts/deploy-functions.ts
// Requires:
//   SUPABASE_ACCESS_TOKEN  – Personal Access Token from supabase.com/dashboard/account/tokens
//   SUPABASE_URL           – used to derive project-ref
//   GEMINI_API_KEY, TELEGRAM_*, NEXT_PUBLIC_APP_URL, VERCEL_CRON_SECRET
//                          – pushed as secrets to the Supabase project
//
// Reserved env vars (SUPABASE_URL, *_KEY, SUPABASE_DB_URL) are NOT pushed —
// the Edge Function runtime injects them automatically.

import { execSync } from "node:child_process";

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

const SECRETS_TO_PUSH = [
  "GEMINI_API_KEY",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_BOT_USERNAME",
  "TELEGRAM_WEBHOOK_SECRET",
  "NEXT_PUBLIC_APP_URL",
  "VERCEL_CRON_SECRET",
] as const;

const url = process.env.SUPABASE_URL;
const accessToken = process.env.SUPABASE_ACCESS_TOKEN;

if (!url) throw new Error("SUPABASE_URL missing");
if (!accessToken) {
  throw new Error(
    "SUPABASE_ACCESS_TOKEN missing in .env.local — generate one at " +
      "https://supabase.com/dashboard/account/tokens",
  );
}

const projectRef = url.match(/https:\/\/([^.]+)\./)?.[1];
if (!projectRef) throw new Error(`Could not derive project-ref from SUPABASE_URL=${url}`);

function run(cmd: string) {
  console.log(`$ ${cmd}`);
  execSync(cmd, {
    stdio: "inherit",
    env: { ...process.env, SUPABASE_ACCESS_TOKEN: accessToken },
  });
}

// 1. Sync secrets
console.log(`→ Pushing secrets to ${projectRef}…`);
const secretArgs: string[] = [];
for (const key of SECRETS_TO_PUSH) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing env var to push: ${key}`);
  // shell-escape: wrap in single quotes, escape any embedded single quotes
  const escaped = `'${value.replace(/'/g, `'\\''`)}'`;
  secretArgs.push(`${key}=${escaped}`);
}
run(`supabase secrets set --project-ref ${projectRef} ${secretArgs.join(" ")}`);

// 2. Deploy each function
for (const fn of FUNCTIONS) {
  console.log(`\n→ Deploying ${fn}…`);
  // Imports come from supabase/functions/deno.json (auto-detected by the CLI).
  run(
    ["supabase", "functions", "deploy", fn, "--project-ref", projectRef, "--no-verify-jwt"].join(
      " ",
    ),
  );
}

console.log(
  `\n✓ Deploy complete. Functions live at https://${projectRef}.functions.supabase.co/<name>`,
);
