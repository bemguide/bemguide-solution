// SSE-streaming client for the bemguide-chat agent backend.
//
// V0 has no auth — every call sends `?user_id=<uuid>`. The integration
// guide warns this'll change to `Authorization: Bearer` in V1, so this
// module is the *only* place that knows about the auth shape; one
// helper to swap when V1 lands.
//
// Why we don't use `EventSource`:
//   - Native EventSource is GET-only; `/v1/agent/messages` is POST.
//   - Manual fetch + ReadableStream lets us pass an AbortSignal to
//     bail out cleanly when the user navigates away mid-stream.

"use client";

import type { AgentSseEvent } from "./types";

export class AgentApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AgentApiError";
  }
}

const RAW_BASE_URL = (process.env.NEXT_PUBLIC_AGENT_BASE_URL ?? "").trim();

/** `null` when the env var isn't configured — UI uses this to hide the tab. */
export function getAgentBaseUrl(): string | null {
  return RAW_BASE_URL || null;
}

function requireBaseUrl(): string {
  if (!RAW_BASE_URL) {
    throw new AgentApiError(
      "config",
      "NEXT_PUBLIC_AGENT_BASE_URL is not set",
      0,
    );
  }
  return RAW_BASE_URL;
}

/** Build the auth fragment of every URL. Single source of truth — when
 *  V1 lands and auth moves to a Bearer header, the swap happens here. */
function authQueryString(userId: string): string {
  return `user_id=${encodeURIComponent(userId)}`;
}

// ----------------------------------------------------------------
// SSE stream — POST /v1/agent/messages
// ----------------------------------------------------------------

/**
 * Stream the agent's reply. `conversationId` is `null` on the first
 * turn — the server mints a fresh ID and emits it as the first
 * `conversation` event; the caller persists it and passes it back
 * on the next turn to keep history.
 *
 * Throws `AgentApiError` *before* yielding anything when the request
 * itself fails (non-2xx). Once the stream starts, errors arrive as
 * a single `error` event in the iterator output.
 */
export async function* streamChat({
  userId,
  conversationId,
  userMessage,
  signal,
}: {
  userId: string;
  conversationId: string | null;
  userMessage: string;
  signal?: AbortSignal;
}): AsyncGenerator<AgentSseEvent, void, unknown> {
  const base = requireBaseUrl();
  const url = `${base}/v1/agent/messages?${authQueryString(userId)}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        user_message: userMessage,
      }),
      // `cache: 'no-store'` is defensive — POSTs aren't cacheable
      // in any sane client, but Telegram's WebView has been seen to
      // memoize fetch responses in some configs; this kills the
      // possibility cleanly.
      cache: "no-store",
      signal,
    });
  } catch (err) {
    // Network-level failure (DNS, CORS preflight, abort, etc.).
    if ((err as { name?: string } | null)?.name === "AbortError") throw err;
    throw new AgentApiError(
      "network",
      (err as Error)?.message ?? "Network error",
      0,
    );
  }

  if (!resp.ok || !resp.body) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await resp.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON body — fall through with status text */
    }
    throw new AgentApiError(
      body.error ?? "http_error",
      body.message ?? resp.statusText,
      resp.status,
    );
  }

  const reader = resp.body
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = "";

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      // Frames are separated by a blank line. Each frame is one or
      // more `event:`/`data:` lines. We only honour the standard
      // pair; anything else is a forward-compat no-op.
      let sep: number;
      while ((sep = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);

        let eventName = "message";
        let dataLine = "";
        for (const line of frame.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            // Per SSE spec, multiple `data:` lines concatenate with
            // newlines; in practice the agent backend uses a single
            // line, so this loop just collects what arrived.
            dataLine += line.slice(5).trim();
          }
        }
        if (!dataLine) continue;
        try {
          yield {
            event: eventName,
            data: JSON.parse(dataLine),
          } as AgentSseEvent;
        } catch {
          // Malformed frame — drop and keep streaming. The backend
          // signals real failures via an explicit `error` event.
        }
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      /* fine — already finished */
    }
  }
}

// ----------------------------------------------------------------
// Buffered fallback — for when the streamed body never delivers
// ----------------------------------------------------------------

/**
 * Same `/v1/agent/messages` POST as `streamChat`, but waits for the
 * full response body via `response.text()` and parses all SSE frames
 * at once. This is the iOS WebView / aggressive-buffering-proxy
 * fallback: the network layer holds bytes until the connection
 * closes, then `response.text()` returns the entire payload at once.
 *
 * Trade-off: no progressive token rendering — the user sees nothing
 * during generation, then everything in rapid sequence. Worth it
 * compared to an infinite spinner, and short enough at 600 max
 * tokens (~3-5s on gpt-4o-mini) that it doesn't feel broken.
 *
 * Yields the parsed SSE frames in their original order, so the
 * caller's existing event-handling switch works without changes.
 */
export async function* streamChatBuffered({
  userId,
  conversationId,
  userMessage,
  signal,
}: {
  userId: string;
  conversationId: string | null;
  userMessage: string;
  signal?: AbortSignal;
}): AsyncGenerator<AgentSseEvent, void, unknown> {
  const base = requireBaseUrl();
  const url = `${base}/v1/agent/messages?${authQueryString(userId)}`;

  let resp: Response;
  try {
    resp = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
      },
      body: JSON.stringify({
        conversation_id: conversationId,
        user_message: userMessage,
      }),
      cache: "no-store",
      signal,
    });
  } catch (err) {
    if ((err as { name?: string } | null)?.name === "AbortError") throw err;
    throw new AgentApiError(
      "network",
      (err as Error)?.message ?? "Network error",
      0,
    );
  }

  if (!resp.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await resp.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON */
    }
    throw new AgentApiError(
      body.error ?? "http_error",
      body.message ?? resp.statusText,
      resp.status,
    );
  }

  const text = await resp.text();
  // Parse the same `event:` / `data:` framing the streaming path
  // walks — the body shape is identical, we just got it all at once.
  for (const rawFrame of text.split("\n\n")) {
    const frame = rawFrame.trim();
    if (!frame) continue;

    let eventName = "message";
    let dataLine = "";
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        dataLine += line.slice(5).trim();
      }
    }
    if (!dataLine) continue;
    try {
      yield {
        event: eventName,
        data: JSON.parse(dataLine),
      } as AgentSseEvent;
    } catch {
      /* malformed frame — same handling as streaming path */
    }
  }
}

// ----------------------------------------------------------------
// Non-streaming endpoints
// ----------------------------------------------------------------

async function jsonFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const resp = await fetch(`${requireBaseUrl()}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    let body: { error?: string; message?: string } = {};
    try {
      body = (await resp.json()) as { error?: string; message?: string };
    } catch {
      /* non-JSON */
    }
    throw new AgentApiError(
      body.error ?? "http_error",
      body.message ?? resp.statusText,
      resp.status,
    );
  }
  return (await resp.json()) as T;
}

import type {
  AgentConversationSummary,
  AgentFact,
  AgentTranscript,
} from "./types";

export function listFacts(userId: string): Promise<{ facts: AgentFact[] }> {
  return jsonFetch(`/v1/agent/memory?${authQueryString(userId)}`);
}

export function addFact(
  userId: string,
  body: { kind: string; value: string },
): Promise<AgentFact> {
  return jsonFetch(`/v1/agent/memory?${authQueryString(userId)}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteFact(userId: string, factId: string): Promise<void> {
  return jsonFetch(
    `/v1/agent/memory/${factId}?${authQueryString(userId)}`,
    { method: "DELETE" },
  );
}

export function listConversations(
  userId: string,
): Promise<{ conversations: AgentConversationSummary[] }> {
  return jsonFetch(`/v1/agent/conversations?${authQueryString(userId)}`);
}

export function getTranscript(
  userId: string,
  conversationId: string,
): Promise<AgentTranscript> {
  return jsonFetch(
    `/v1/agent/conversations/${conversationId}?${authQueryString(userId)}`,
  );
}

export function deleteConversation(
  userId: string,
  conversationId: string,
): Promise<void> {
  return jsonFetch(
    `/v1/agent/conversations/${conversationId}?${authQueryString(userId)}`,
    { method: "DELETE" },
  );
}
