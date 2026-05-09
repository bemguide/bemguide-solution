// M4 stub. Real copy generation (why_this / reminder_24h / reminder_10m / description_clean) lands in M5.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "gemini-copy", note: "stub — full implementation lands in M5" });
});
