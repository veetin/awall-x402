import { eq } from "drizzle-orm";
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
  /** Clock override, so tests can seed events older than the retention window. */
  createdAt?: Date;
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
      ...(input.createdAt === undefined ? {} : { createdAt: input.createdAt }),
    })
    .returning();
  if (!row) throw new Error("usage_events insert returned no row");
  return row;
}

export type UsageEventPatch = {
  credits?: number;
  decision?: Decision;
  originStatus?: number | null;
  latencyMs?: number | null;
};

/**
 * Fill in the origin status and the final credit cost after the response.
 *
 * @param db - Connection or open transaction.
 * @param id - Usage event id.
 * @param patch - Fields learned after the origin responded.
 * @returns The updated row, or `null` when the id is unknown.
 */
export async function finishUsageEvent(
  db: Database,
  id: bigint,
  patch: UsageEventPatch,
): Promise<UsageEvent | null> {
  const [row] = await db
    .update(usageEvents)
    .set({
      ...(patch.credits === undefined ? {} : { credits: patch.credits }),
      ...(patch.decision === undefined ? {} : { decision: patch.decision }),
      ...(patch.originStatus === undefined ? {} : { originStatus: patch.originStatus }),
      ...(patch.latencyMs === undefined ? {} : { latencyMs: patch.latencyMs }),
    })
    .where(eq(usageEvents.id, id))
    .returning();
  return row ?? null;
}
