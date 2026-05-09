// Node-compatible Telegram WebApp initData verifier. Mirror of
// supabase/functions/_shared/initdata.ts (which runs on Deno).
//
// All Mini App POSTs from the client carry the raw initData string in the
// `X-Telegram-InitData` header. Server verifies the HMAC against
// TELEGRAM_BOT_TOKEN before trusting any user.id field.

import { webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;
const enc = new TextEncoder();

export type TgInitDataUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
};

export type TgInitData = {
  user?: TgInitDataUser;
  auth_date: number;
  query_id?: string;
  start_param?: string;
};

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (await subtle.sign("HMAC", cryptoKey, enc.encode(msg))) as ArrayBuffer;
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyInitData(
  raw: string | null | undefined,
  opts: { maxAgeSec?: number } = {},
): Promise<TgInitData | null> {
  if (!raw) return null;
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;

  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  let computedHex: string;
  try {
    const secret = await hmac(enc.encode("WebAppData"), botToken);
    computedHex = bufToHex(await hmac(secret, dataCheckString));
  } catch {
    return null;
  }
  if (computedHex !== hash) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || authDate <= 0) return null;
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  const maxAge = opts.maxAgeSec ?? 24 * 3600;
  if (ageSec > maxAge) return null;
  if (ageSec < -300) return null;

  let user: TgInitDataUser | undefined;
  const userJson = params.get("user");
  if (userJson) {
    try {
      user = JSON.parse(userJson) as TgInitDataUser;
    } catch {
      return null;
    }
  }

  return {
    user,
    auth_date: authDate,
    query_id: params.get("query_id") ?? undefined,
    start_param: params.get("start_param") ?? undefined,
  };
}
