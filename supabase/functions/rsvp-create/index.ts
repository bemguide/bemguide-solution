// M4 stub. Real RSVP creation (initData verify + qr_token + reminders schedule) lands in M10.

import { ok } from "../_shared/responses.ts";
import { handleCors } from "../_shared/cors.ts";

Deno.serve((req) => {
  const cors = handleCors(req);
  if (cors) return cors;
  return ok({ fn: "rsvp-create", note: "stub — full implementation lands in M10" });
});
