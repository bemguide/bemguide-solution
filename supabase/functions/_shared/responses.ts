// Uniform JSON response envelope for all edge functions.
// `ok` and `err` always emit `{ ok: boolean, ... }` so clients can branch on a single field.

import { corsHeaders } from "./cors.ts";

export function ok(data: Record<string, unknown> = {}, init: ResponseInit = {}) {
  return new Response(JSON.stringify({ ok: true, ...data }), {
    status: 200,
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
      ...init.headers,
    },
  });
}

export function err(message: string, status = 400, extra: Record<string, unknown> = {}) {
  return new Response(JSON.stringify({ ok: false, error: message, ...extra }), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...corsHeaders,
    },
  });
}
