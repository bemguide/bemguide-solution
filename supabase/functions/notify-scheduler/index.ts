// M4 stub. Real notification dispatcher (poll pending → render template → TG sendMessage) lands in M11.
// Triggered by Vercel cron via /api/cron/notify which forwards with VERCEL_CRON_SECRET.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "notify-scheduler", note: "stub — full implementation lands in M11" });
});
