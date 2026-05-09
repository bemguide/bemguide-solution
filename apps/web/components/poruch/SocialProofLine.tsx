// Small grey line under a card with a precomputed social-proof string.
// Caller is responsible for the wording (typically built server-side).

import { Users } from "lucide-react";

export function SocialProofLine({ text }: { text: string }) {
  if (!text) return null;
  return (
    <p className="text-muted-foreground inline-flex items-center gap-1 text-xs">
      <Users className="h-3 w-3" aria-hidden />
      {text}
    </p>
  );
}
