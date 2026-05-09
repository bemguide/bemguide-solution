// M4 stub. Real grammY router lands in M6.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "bot", note: "stub — grammY handler lands in M6" });
});
