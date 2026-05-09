// M4 stub. Real pre-screen scoring (red flags + suggested edits) lands in M5.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "gemini-moderate", note: "stub — full implementation lands in M5" });
});
