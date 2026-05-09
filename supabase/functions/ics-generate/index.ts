// M4 stub. Real .ics generation (VALARM 24h, TZID Europe/Kyiv) lands in M10.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "ics-generate", note: "stub — full implementation lands in M10" });
});
