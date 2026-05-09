// Small grey line under a card with a precomputed social-proof string.
// Caller is responsible for the wording (typically built server-side).

export function SocialProofLine({ text }: { text: string }) {
  if (!text) return null;
  return <p className="text-muted-foreground text-xs">{text}</p>;
}
