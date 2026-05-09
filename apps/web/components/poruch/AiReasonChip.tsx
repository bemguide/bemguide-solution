// One-line "чому саме це" highlight. Uses the accent-soft palette so it reads
// as informational rather than promotional. Optional ⓘ button reveals what
// signals fed the AI (transparency commitment).

export function AiReasonChip({
  reason,
  onShowSignals,
}: {
  reason: string;
  onShowSignals?: () => void;
}) {
  if (!reason) return null;
  return (
    <div className="bg-accent text-accent-foreground flex items-start gap-2 rounded-lg px-3 py-2 text-sm leading-snug">
      <span className="flex-1">{reason}</span>
      {onShowSignals ? (
        <button
          type="button"
          onClick={onShowSignals}
          className="hover:bg-accent-foreground/10 rounded px-1 text-xs underline decoration-dotted"
        >
          що це
        </button>
      ) : null}
    </div>
  );
}
