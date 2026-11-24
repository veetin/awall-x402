import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Database } from "./db.js";
import { newId } from "./ids.js";
import {
  adminAudit,
  creditLedger,
  identities,
  offers,
  payments,
  policyVersions,
  usageEvents,
  usageRollups,
  type AdminAuditEntry,
  type CreditLedgerEntry,
  type Identity,
  type Offer,
  type Payment,
  type PolicyVersion,
  type UsageEvent,
  type UsageRollup,
} from "./schema.js";

function hourFloor(instant: Date): Date {
  return new Date(
    Date.UTC(
      instant.getUTCFullYear(),
      instant.getUTCMonth(),
      instant.getUTCDate(),
      instant.getUTCHours(),
    ),
  );
}

/**
 * Add one request to the hourly rollup. Called beside every usage event.
 *
 * @param db - Connection or open transaction.
 * @param input - Identity, route, when, and how many credits were charged.
 */
export async function bumpUsageRollup(
  db: Database,
  input: {
    identityId: string;
    route: string;
    at: Date;
    credits: number;
    /** Credits that came out of a paid balance. */
    paidCredits: number;
  },
): Promise<void> {
  const hour = hourFloor(input.at);
  await db
    .insert(usageRollups)
    .values({
      identityId: input.identityId,
      route: input.route,
      hour,
      requests: 1,
      credits: input.credits,
      paidCredits: input.paidCredits,
    })
    .onConflictDoUpdate({
      target: [usageRollups.identityId, usageRollups.route, usageRollups.hour],
      set: {
        requests: sql`${usageRollups.requests} + 1`,
        credits: sql`${usageRollups.credits} + ${input.credits}`,
        paidCredits: sql`${usageRollups.paidCredits} + ${input.paidCredits}`,
      },
    });
}

/**
 * Delete raw usage events older than `olderThan`. Rollups are left in place.
 *
 * @param db - Connection or open transaction.
 * @param olderThan - Events at or before this instant are removed.
 * @returns How many rows were deleted.
 */
export async function purgeUsageEvents(db: Database, olderThan: Date): Promise<number> {
  const deleted = await db
    .delete(usageEvents)
    .where(lte(usageEvents.createdAt, olderThan))
    .returning({ id: usageEvents.id });
  return deleted.length;
}

export type UsageFilter = {
  from?: Date;
  to?: Date;
  identityId?: string;
  decision?: string;
  limit?: number;
};

/** Recent raw events, newest first. The live console uses this. */
export async function listUsageEvents(db: Database, filter: UsageFilter = {}): Promise<UsageEvent[]> {
  const where = and(
    filter.from ? gte(usageEvents.createdAt, filter.from) : undefined,
    filter.to ? lte(usageEvents.createdAt, filter.to) : undefined,
    filter.identityId ? eq(usageEvents.identityId, filter.identityId) : undefined,
    filter.decision ? eq(usageEvents.decision, filter.decision) : undefined,
  );
  return db
    .select()
    .from(usageEvents)
    .where(where)
    .orderBy(desc(usageEvents.createdAt))
    .limit(filter.limit ?? 200);
}

/** Hourly aggregates. Historical screens read these, not the raw events. */
export async function listUsageRollups(
  db: Database,
  filter: { from?: Date; to?: Date; identityId?: string } = {},
): Promise<UsageRollup[]> {
  const where = and(
    filter.from ? gte(usageRollups.hour, filter.from) : undefined,
    filter.to ? lte(usageRollups.hour, filter.to) : undefined,
    filter.identityId ? eq(usageRollups.identityId, filter.identityId) : undefined,
  );
  return db.select().from(usageRollups).where(where).orderBy(desc(usageRollups.hour));
}

/** Every identity, most recently seen first. */
export async function listIdentities(db: Database, limit = 200): Promise<Identity[]> {
  return db.select().from(identities).orderBy(desc(identities.lastSeenAt)).limit(limit);
}

/** Ledger lines of one identity, newest first. */
export async function listLedgerEntries(
  db: Database,
  identityId: string,
  limit = 100,
): Promise<CreditLedgerEntry[]> {
  return db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.identityId, identityId))
    .orderBy(desc(creditLedger.id))
    .limit(limit);
}

/** Payments, newest first, optionally filtered by status. */
export async function listPayments(db: Database, status?: string, limit = 200): Promise<Payment[]> {
  return db
    .select()
    .from(payments)
    .where(status ? eq(payments.status, status) : undefined)
    .orderBy(desc(payments.createdAt))
    .limit(limit);
}

/** Offers, newest first. */
export async function listOffers(db: Database, limit = 200): Promise<Offer[]> {
  return db.select().from(offers).orderBy(desc(offers.createdAt)).limit(limit);
}

/**
 * Counters for one window, read from raw events.
 *
 * Long windows should use {@link listUsageRollups} instead: the raw table is
 * only kept for 7 days and is the wrong source for a historical screen.
 */
export async function summarizeUsage(
  db: Database,
  from: Date,
): Promise<{ decision: string; requests: number; credits: number }[]> {
  const rows = await db
    .select({
      decision: usageEvents.decision,
      requests: sql<number>`count(*)::int`,
      credits: sql<number>`coalesce(sum(${usageEvents.credits}), 0)::int`,
    })
    .from(usageEvents)
    .where(gte(usageEvents.createdAt, from))
    .groupBy(usageEvents.decision);
  return rows.map((row) => ({
    decision: row.decision,
    requests: Number(row.requests),
    credits: Number(row.credits),
  }));
}

export type RevenueRow = { rail: string; asset: string; count: number; amount: string };

/**
 * Settled payments in the window, summed per rail **and asset**.
 *
 * Grouping by rail alone would add XLM atomic units to USDC atomic units: both
 * ride the `exact` rail and both have 7 decimals, so the sum looks plausible
 * and means nothing. Amounts stay integer strings.
 */
export async function summarizeRevenue(db: Database, from: Date): Promise<RevenueRow[]> {
  const rows = await db
    .select({
      rail: payments.rail,
      asset: payments.asset,
      count: sql<number>`count(*)::int`,
      amount: sql<string>`coalesce(sum(${payments.amount}::numeric), 0)::text`,
    })
    .from(payments)
    .where(and(eq(payments.status, "settled"), gte(payments.createdAt, from)))
    .groupBy(payments.rail, payments.asset);
  return rows.map((row) => ({
    rail: row.rail,
    asset: row.asset,
    count: Number(row.count),
    amount: String(row.amount),
  }));
}

/** The policy version currently in force, if the console has applied one. */
export async function activePolicyVersion(db: Database): Promise<PolicyVersion | null> {
  const [row] = await db
    .select()
    .from(policyVersions)
    .where(eq(policyVersions.active, true))
    .orderBy(desc(policyVersions.createdAt))
    .limit(1);
  return row ?? null;
}

export async function listPolicyVersions(db: Database, limit = 50): Promise<PolicyVersion[]> {
  return db.select().from(policyVersions).orderBy(desc(policyVersions.createdAt)).limit(limit);
}

/**
 * Store a policy version and make it the only active one.
 *
 * @param db - Connection or open transaction.
 * @param input - Validated policy document, its hash, and who applied it.
 * @returns The stored version.
 */
export async function savePolicyVersion(
  db: Database,
  input: { content: unknown; contentHash: string; appliedBy: string },
): Promise<PolicyVersion> {
  return db.transaction(async (tx) => {
    await tx.update(policyVersions).set({ active: false }).where(eq(policyVersions.active, true));
    const [row] = await tx
      .insert(policyVersions)
      .values({
        id: newId("pol"),
        content: input.content,
        contentHash: input.contentHash,
        appliedBy: input.appliedBy,
        active: true,
      })
      .returning();
    if (!row) throw new Error("policy_versions insert returned no row");
    return row;
  });
}

/** Append one administrative action. Rows are never updated. */
export async function writeAdminAudit(
  db: Database,
  input: { action: string; actor: string; payload: unknown; result: string },
): Promise<AdminAuditEntry> {
  const [row] = await db
    .insert(adminAudit)
    .values({
      action: input.action,
      actor: input.actor,
      payload: input.payload,
      result: input.result,
    })
    .returning();
  if (!row) throw new Error("admin_audit insert returned no row");
  return row;
}

export async function listAdminAudit(db: Database, limit = 100): Promise<AdminAuditEntry[]> {
  return db.select().from(adminAudit).orderBy(desc(adminAudit.id)).limit(limit);
}
