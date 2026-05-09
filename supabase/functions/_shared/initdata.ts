// Telegram Mini App initData verification.
// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
//
// Algorithm:
//   data_check_string = sorted "{key}={value}" pairs joined by "\n", excluding `hash`
//   secret_key        = HMAC_SHA256(message=bot_token,        key="WebAppData")
//   computed_hash     = HMAC_SHA256(message=data_check_string, key=secret_key)
//   if computed_hash !== hash -> reject
//   if auth_date older than 24h -> reject
//
// Returns the parsed user blob on success, or null on any failure (malformed, hash
// mismatch, expired). Callers decide whether to issue 401.

import { env } from "./env.ts";

export type TgInitDataUser = {
  id: number;
  is_bot?: boolean;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
};

export type TgInitData = {
  user?: TgInitDataUser;
  auth_date: number;
  query_id?: string;
  start_param?: string;
};

const enc = new TextEncoder();

async function hmac(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  // Cast: WebCrypto's BufferSource excludes SharedArrayBuffer-backed views, but
  // we only ever pass ArrayBuffer or Uint8Array<ArrayBuffer> here.
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return (await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg))) as ArrayBuffer;
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export type VerifyOpts = {
  /** Maximum auth_date age in seconds. Default 24h per Telegram docs. */
  maxAgeSec?: number;
};

export async function verifyInitData(
  raw: string | null | undefined,
  opts: VerifyOpts = {},
): Promise<TgInitData | null> {
  if (!raw) return null;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return null;
  }
  const hash = params.get("hash");
  if (!hash) return null;

  // Build sorted data_check_string
  const pairs: string[] = [];
  for (const [k, v] of params.entries()) {
    if (k === "hash") continue;
    pairs.push(`${k}=${v}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  // secret_key = HMAC_SHA256(bot_token, "WebAppData")
  let secret: ArrayBuffer;
  let computedHex: string;
  try {
    secret = await hmac(enc.encode("WebAppData"), env.tgBotToken());
    computedHex = bufToHex(await hmac(secret, dataCheckString));
  } catch {
    return null;
  }

  if (computedHex !== hash) return null;

  const authDateRaw = Number(params.get("auth_date"));
  if (!Number.isFinite(authDateRaw) || authDateRaw <= 0) return null;
  const ageSec = Math.floor(Date.now() / 1000) - authDateRaw;
  const maxAge = opts.maxAgeSec ?? 24 * 3600;
  if (ageSec > maxAge) return null;
  if (ageSec < -300) return null; // future timestamp beyond 5 min skew

  let user: TgInitDataUser | undefined;
  const userJson = params.get("user");
  if (userJson) {
    try {
      user = JSON.parse(userJson);
    } catch {
      return null;
    }
  }

  return {
    user,
    auth_date: authDateRaw,
    query_id: params.get("query_id") ?? undefined,
    start_param: params.get("start_param") ?? undefined,
  };
}
