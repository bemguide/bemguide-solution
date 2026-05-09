// Render arbitrary text with URLs turned into compact host-only
// links. Opens in a new context (`target="_blank"`) so inside a
// Telegram WebApp the link uses TG's inline browser instead of
// hijacking the Mini App view.

import { splitOnUrls, prettyUrlHost } from "@/lib/url";

export function Autolink({
  text,
  className,
  /** Custom link className. Default = primary, underline-on-hover. */
  linkClassName,
}: {
  text: string;
  className?: string;
  linkClassName?: string;
}) {
  if (!text) return null;
  const parts = splitOnUrls(text);
  if (parts.length === 0) return null;

  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.kind === "url" ? (
          <a
            key={i}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className={
              linkClassName ??
              "text-primary inline-flex max-w-full items-center break-words underline underline-offset-2 hover:no-underline"
            }
          >
            {prettyUrlHost(p.url)}
          </a>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}
