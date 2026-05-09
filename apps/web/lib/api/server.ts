// Server-side fetch for SSR pages (the public /event/[id]). Public
// endpoints only — no Authorization header. Uses Node's global fetch.
//
// Keep this thin: the same code path is used at request time on Vercel,
// at build time for static generation, and in `next dev`. Never reads
// from sessionStorage; never writes to it.

import { ApiError } from "./client";

// Server-side reads can use a server-only env var if set, otherwise fall
// back to the public one (the client-side code already requires it).
const API_BASE = process.env.API_BASE ?? process.env.NEXT_PUBLIC_API_BASE ?? "";

type ServerOpts = {
  /** ISR interval in seconds. `0` = always dynamic. Default: `60`. */
  revalidate?: number;
  signal?: AbortSignal;
};

/**
 * GET a public endpoint from the v2 backend on the server. Use only for
 * routes the backend marks public (currently `/opportunities/:id` and
 * `/opportunities/:id/attendees`).
 */
export async function serverGet<T>(path: string, opts: ServerOpts = {}): Promise<T> {
  if (!API_BASE) {
    throw new ApiError(0, "NEXT_PUBLIC_API_BASE is not set");
  }
  const url = `${API_BASE.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: opts.signal,
    next: { revalidate: opts.revalidate ?? 60 },
  });
  let parsed: unknown;
  const text = await res.text();
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const code =
      typeof parsed === "object" && parsed && "error" in parsed
        ? String((parsed as { error: unknown }).error)
        : null;
    throw new ApiError(res.status, code ?? `HTTP ${res.status}`, parsed);
  }
  return parsed as T;
}
