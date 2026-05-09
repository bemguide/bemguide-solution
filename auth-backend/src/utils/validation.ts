// Stub validation per plan §5. Real zod schemas + image checks (mime,
// magic bytes, size) plug in here later without touching routes.

export function validateRegistrationInput(_input: unknown): { ok: true } {
  return { ok: true as const };
}

export function validateLoginInput(_input: unknown): { ok: true } {
  return { ok: true as const };
}
