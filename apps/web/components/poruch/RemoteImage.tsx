// Plain <img> with chat-friendly defaults. Used in place of next/image
// for any user/admin-supplied URL whose host we can't predict —
// catbox.moe, fastly.picsum.photos, staticflickr, etc. each break
// next/image's optimizer until added to `remotePatterns`, and the
// allowlist whack-a-mole isn't worth what next/image gives us back
// (auto AVIF/WebP) for thumbnails this size.
//
// What we lose vs <Image>:
//   - automatic AVIF/WebP transcoding
//   - srcset based on `sizes`
//   - automatic blur placeholder
//
// What we keep / do ourselves:
//   - lazy loading via the native attribute
//   - async decode so the main thread isn't blocked
//   - LCP hint via `fetchPriority` for the first card in the feed
//   - error fallback that hides the <img> rather than showing the
//     browser's broken-image glyph
//   - `referrerPolicy="no-referrer"` so referrer-sniffing CDNs don't
//     reject Vercel-origin requests (some image hosts do this)
//
// Default styles assume the parent is `position: relative` with a
// fixed aspect-ratio (the existing card markup already does this).

"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function RemoteImage({
  src,
  alt,
  className,
  priority = false,
  ariaHidden,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  /** When true, hint the browser to load eagerly (LCP candidate). */
  priority?: boolean;
  /** Pass `true` for purely decorative thumbnails (e.g. compact card
   *  next to a redundant text title). */
  ariaHidden?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  if (!src || errored) return null;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={ariaHidden ? "" : alt}
      aria-hidden={ariaHidden || undefined}
      onError={() => setErrored(true)}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : "auto"}
      referrerPolicy="no-referrer"
      className={cn(
        "absolute inset-0 h-full w-full object-cover",
        className,
      )}
    />
  );
}
