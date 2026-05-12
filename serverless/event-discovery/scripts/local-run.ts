/**
 * Run the daily sync locally without Vercel — for smoke-testing the whole pipeline.
 * Reads .env via tsx --env-file-if-exists. Writes the same console output the
 * cron handler would, plus the full SyncStats JSON.
 *
 *   npm run test:local
 */

import { runDailySync } from "../lib/orchestrator.js";

async function main() {
  const stats = await runDailySync();
  console.log("\n=== SyncStats ===");
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
