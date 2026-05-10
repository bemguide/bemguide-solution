// Tiny sessionStorage wrapper for the agent's conversation_id.
//
// Why sessionStorage (not localStorage):
//   The integration guide warns the V0 backend keeps history in-memory
//   and drops it on restart. Surviving a client-side reload is helpful;
//   surviving a longer absence is misleading because the server probably
//   already 404'd the conversation. sessionStorage matches that lifetime
//   exactly — same tab, same session, no false-positive resumes.
//
// Per-user keying lets two different Telegram accounts on the same device
// (rare but possible) keep separate threads without crosstalk.

"use client";

const KEY = (userId: string): string => `poruch.agent.conv.${userId}`;

export function readConversationId(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(KEY(userId));
  } catch {
    return null;
  }
}

export function writeConversationId(
  userId: string,
  conversationId: string,
): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(KEY(userId), conversationId);
  } catch {
    /* full / blocked — best-effort only */
  }
}

export function clearConversationId(userId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(KEY(userId));
  } catch {
    /* fine */
  }
}
