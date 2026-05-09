// Opaque keyset cursors. Each route picks its own shape (e.g. {ts,id} for
// timestamp pagination, {score,event_id} for score-ranked lists). The shape is
// JSON-encoded as base64url so clients treat it as opaque.

export function encodeCursor<T extends object>(c: T): string {
  return Buffer.from(JSON.stringify(c)).toString('base64url');
}

export function decodeCursor<T extends object>(c: string): T | null {
  try {
    const parsed = JSON.parse(Buffer.from(c, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object') return parsed as T;
    return null;
  } catch {
    return null;
  }
}

export function clampLimit(raw: number | undefined, def = 25, max = 100): number {
  return Math.min(Math.max(raw ?? def, 1), max);
}
