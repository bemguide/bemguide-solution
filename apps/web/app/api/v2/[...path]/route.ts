// Same-origin proxy for the v2 backend. The Mini App fetches
// `/api/v2/...` (which lives on the same origin as the page), and this
// route forwards the request to the upstream Railway service whose
// CORS allowlist + uptime is owned by a different team.
//
// Why proxy at all:
//   1. Eliminates CORS as a concern. The browser never makes a cross-
//      origin request, so we don't need the upstream to allowlist
//      every Vercel preview URL or to add CORS headers on 5xx
//      responses (where Railway currently drops them).
//   2. Hides upstream infrastructure. If we move from Railway to
//      another host, only `V2_API_BASE_URL` changes.
//   3. Lets us return an actionable error envelope when the upstream
//      is unreachable, instead of the browser's "Failed to fetch /
//      CORS blocked" combo that masks the real cause.
//
// Streaming: this route forwards `upstream.body` as-is, so SSE / large
// JSON payloads stream through without being buffered server-side.
//
// Auth: forwards `Authorization` (Bearer token) verbatim. Cookies and
// other headers are stripped so the upstream never sees Vercel's
// session cookies.
//
// Env:
//   V2_API_BASE_URL          — server-only; preferred. Trailing slash
//                               tolerated.
//   NEXT_PUBLIC_API_BASE     — backwards-compat fallback for envs
//                               that haven't migrated yet (e.g. local
//                               dev pointing at an ngrok tunnel).

import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

const UPSTREAM_BASE = (
  process.env.V2_API_BASE_URL ??
  process.env.NEXT_PUBLIC_API_BASE ??
  ""
).replace(/\/+$/, "");

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailers",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length",
  "cookie",
]);

function buildForwardHeaders(req: NextRequest): Headers {
  const fwd = new Headers();
  for (const [k, v] of req.headers) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    fwd.set(k, v);
  }
  // Override `accept` if the client didn't specify one — JSON is the
  // sane default for the v2 contract.
  if (!fwd.has("accept")) fwd.set("accept", "application/json");
  return fwd;
}

function buildResponseHeaders(upstream: Response): Headers {
  const out = new Headers();
  for (const [k, v] of upstream.headers) {
    if (HOP_BY_HOP.has(k.toLowerCase())) continue;
    // Strip CORS allow-* — browser is on the same origin now, so the
    // upstream's old allowlist is irrelevant and would only confuse
    // diagnostic tools.
    if (k.toLowerCase().startsWith("access-control-")) continue;
    out.set(k, v);
  }
  return out;
}

async function proxy(
  req: NextRequest,
  ctx: { params: Promise<{ path: string[] }> },
) {
  if (!UPSTREAM_BASE) {
    return NextResponse.json(
      {
        ok: false,
        error: "v2_backend_not_configured",
        message:
          "V2_API_BASE_URL (preferred) or NEXT_PUBLIC_API_BASE must be set on the server.",
      },
      { status: 500 },
    );
  }

  const { path } = await ctx.params;
  const url = `${UPSTREAM_BASE}/${path.join("/")}${req.nextUrl.search}`;

  const hasBody = req.method !== "GET" && req.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      method: req.method,
      headers: buildForwardHeaders(req),
      body: hasBody ? await req.arrayBuffer() : undefined,
      cache: "no-store",
      // Tell Next this is a fresh, dynamic call — never let
      // Vercel's edge cache surprise us.
      next: { revalidate: 0 },
    });
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: "upstream_unreachable",
        message: e instanceof Error ? e.message : String(e),
      },
      { status: 502 },
    );
  }

  return new NextResponse(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: buildResponseHeaders(upstream),
  });
}

export const GET = proxy;
export const POST = proxy;
export const PATCH = proxy;
export const PUT = proxy;
export const DELETE = proxy;

// Same-origin requests don't trigger CORS preflight, so OPTIONS
// passthrough exists only for clients that explicitly send one
// (e.g. legacy XHR).
export const OPTIONS = proxy;

// Mark the route as dynamic so Next doesn't try to prerender it.
export const dynamic = "force-dynamic";
