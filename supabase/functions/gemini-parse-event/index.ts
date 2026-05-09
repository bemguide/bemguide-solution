// M4 stub. Real NL → EventDraft parsing + clarifying-question loop lands in M5.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "gemini-parse-event", note: "stub — full implementation lands in M5" });
});
