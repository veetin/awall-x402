import type { Database } from "./db.js";
import { usageEvents, type UsageEvent } from "./schema.js";

/** Why the request was served, or not. */
export type Decision = "allow_free" | "allow_credit" | "payment_required" | "refunded";

export type UsageEventInput = {
  identityId: string;
  method: string;
  /** Policy pattern that matched, not the raw path. */
  route: string;
  /** Credits charged for this request. */
  credits: number;
  decision: Decision;
  /** Status the origin returned, when it was reached. */
  originStatus?: number | null;
  latencyMs?: number | null;
  /** Hash of method + path + query + body, to spot duplicates. */
  requestHash: string;
};

/**
 * Record one request.
 *
 * `decision = 'payment_required'` is the count of requests a rate limit would
 * have dropped; combined with the payments it gives the recovered revenue.
 *
 * @param db - Connection or open transaction.
 * @param input - The request to record.
 * @returns The stored row, including its generated id.
 */
export async function recordUsageEvent(
  db: Database,
  input: UsageEventInput,
): Promise<UsageEvent> {
  const [row] = await db
    .insert(usageEvents)
    .values({
      identityId: input.identityId,
      method: input.method,
      route: input.route,
      credits: input.credits,
      decision: input.decision,
      originStatus: input.originStatus ?? null,
      latencyMs: input.latencyMs ?? null,
      requestHash: input.requestHash,
    })
    .returning();
  if (!row) throw new Error("usage_events insert returned no row");
  return row;
}
