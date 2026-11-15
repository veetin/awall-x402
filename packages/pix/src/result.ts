/**
 * Domain failures are return values in this package, never thrown exceptions:
 * the gateway has to turn a payment failure into a 402 with an `errorReason`,
 * not into a 500. See AGENTS.md.
 */
export type Result<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): { readonly ok: true; readonly value: T } {
  return { ok: true, value };
}

export function err<E>(error: E): { readonly ok: false; readonly error: E } {
  return { ok: false, error };
}
