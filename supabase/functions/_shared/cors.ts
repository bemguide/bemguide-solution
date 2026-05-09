// CORS helpers — used by every edge function called from the Mini App or admin UI.
//
// We allow *any* origin for the public event read paths, since the Mini App opens
// inside Telegram and the public event page is shared across origins. The actual
// authorization happens via X-Telegram-InitData verification or the cron secret.

export const corsHeaders: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers":
    "authorization, x-client-info, apikey, content-type, x-telegram-initdata, x-cron-secret",
  "access-control-allow-methods": "POST, GET, OPTIONS",
};

/** Short-circuit OPTIONS preflight requests. */
export function handleCors(req: Request): Response | null {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  return null;
}
