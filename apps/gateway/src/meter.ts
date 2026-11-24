/**
 * Credits a metered route actually cost, from the origin's `usage.outputTokens`.
 *
 * Stellar has no `upto` scheme, so the adjustment is off-chain. When the origin
 * does not report usage, the estimate stands.
 *
 * @param body - Origin response body.
 * @param estimate - Credits reserved before the call.
 * @returns The final credit cost.
 */
export function meteredCost(body: string, estimate: number): number {
  try {
    const parsed = JSON.parse(body) as { usage?: { outputTokens?: unknown } };
    const tokens = parsed.usage?.outputTokens;
    if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens <= 0) return estimate;
    return Math.max(1, Math.ceil(tokens));
  } catch {
    return estimate;
  }
}
