// URL utilities for free-text fields (organizer_contact, description).
// Backend stores these as raw strings — sometimes plain prose, often a
// label + a long URL like:
//
//   "www.facebook.com · https://www.facebook.com/foo/videos/%D0%BD…"
//
// Rendering them verbatim looks bad and the encoded path overflows the
// viewport. These helpers extract URLs and produce a short host-only
// label so the UI can show "facebook.com" as a tappable link.

const URL_RE = /https?:\/\/\S+/g;

/** First http(s) URL inside `text`, or null if there is none. */
export function extractFirstUrl(text: string | null | undefined): string | null {
  if (!text) return null;
  const m = text.match(/https?:\/\/\S+/);
  return m ? trimTrailingPunctuation(m[0]) : null;
}

/**
 * Short label for a URL — "facebook.com", "instagram.com", etc.
 * Strips `www.`, trims overlong fallbacks. Used as link text so we
 * never show the percent-encoded mess inline.
 */
export function prettyUrlHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host.replace(/^www\./, "");
  } catch {
    return url.length > 32 ? `${url.slice(0, 30)}…` : url;
  }
}

type UrlSegment = { kind: "url"; url: string };
type TextSegment = { kind: "text"; text: string };
export type Segment = UrlSegment | TextSegment;

/**
 * Walk `text` and return alternating text + url segments. Used by
 * <Autolink/> to render long descriptions without overflowing.
 */
export function splitOnUrls(text: string): Segment[] {
  if (!text) return [];
  const out: Segment[] = [];
  let lastIndex = 0;
  // Reset regex state — global regexes carry it across calls.
  URL_RE.lastIndex = 0;
  for (let m = URL_RE.exec(text); m !== null; m = URL_RE.exec(text)) {
    const start = m.index;
    const url = trimTrailingPunctuation(m[0]);
    const end = start + url.length;
    if (start > lastIndex) {
      out.push({ kind: "text", text: text.slice(lastIndex, start) });
    }
    out.push({ kind: "url", url });
    lastIndex = end;
    // If we trimmed punctuation, advance the regex past the trimmed
    // chars so we don't loop forever.
    URL_RE.lastIndex = end;
  }
  if (lastIndex < text.length) {
    out.push({ kind: "text", text: text.slice(lastIndex) });
  }
  return out;
}

/** Strip trailing punctuation we don't want as part of the URL. */
function trimTrailingPunctuation(s: string): string {
  return s.replace(/[.,;:!?)\]}»"']+$/u, "");
}
