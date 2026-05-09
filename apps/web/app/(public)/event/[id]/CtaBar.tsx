// Sticky bottom action bar for the public event page. Client-side because
// `Поділитися` invokes Web Share API + clipboard fallback.

"use client";

import { useState } from "react";
import { Bell, Share2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaBar({
  deepLink,
  deferLink,
  shareUrl,
  shareTitle,
}: {
  deepLink: string;
  deferLink: string;
  shareUrl: string;
  shareTitle: string;
}) {
  const [copied, setCopied] = useState(false);

  async function onShare() {
    if (navigator.share) {
      try {
        await navigator.share({ title: shareTitle, url: shareUrl });
        return;
      } catch {
        // user cancelled or browser refused; fall through to clipboard
      }
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // last resort: open the URL in a new tab so the user can copy manually
      window.open(shareUrl, "_blank", "noopener");
    }
  }

  return (
    <div className="bg-background/95 border-border fixed inset-x-0 bottom-0 z-30 mx-auto w-full max-w-md border-t px-4 py-3 backdrop-blur">
      <div className="space-y-2">
        <Button asChild size="lg" className="h-14 w-full text-base font-semibold">
          <a href={deepLink}>Я буду</a>
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" className="h-11" onClick={onShare}>
            <Share2 className="mr-1.5 h-4 w-4" aria-hidden />
            {copied ? "Скопійовано" : "Поділитися"}
          </Button>
          <Button asChild variant="outline" className="h-11">
            <a href={deferLink}>
              <Bell className="mr-1.5 h-4 w-4" aria-hidden />
              Не зараз
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}
