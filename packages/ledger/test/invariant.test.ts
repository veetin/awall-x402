import { desc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  creditLedger,
  debitCredits,
  getBalance,
  ledgerSum,
  refundCredits,
} from "../src/index.js";
import type { Database } from "../src/db.js";
import {
  createTestDb,
  grantTestCredits,
  mulberry32,
  seedIdentity,
  seedUsageEvent,
  type TestDb,
} from "./helpers/db.js";

/** Last entry of an identity, by insertion order. */
async function lastEntry(db: Database, identityId: string) {
  const [row] = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.identityId, identityId))
    .orderBy(desc(creditLedger.id))
    .limit(1);
  return row ?? null;
}

type Step = { kind: "debit" | "refund" | "grant"; credits: number };

/** Build a random sequence of ledger operations from a seed. */
function plan(random: () => number, length: number): Step[] {
  const steps: Step[] = [];
  for (let i = 0; i < length; i += 1) {
    const roll = random();
    const kind = roll < 0.6 ? "debit" : roll < 0.8 ? "refund" : "grant";
    const credits = kind === "grant" ? 1 + Math.floor(random() * 500) : 1 + Math.floor(random() * 40);
    steps.push({ kind, credits });
  }
  return steps;
}

describe("ledger invariant", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  // One seed per case, so a failure is reproducible from the seed alone.
  for (const seed of [1, 7, 42, 1337, 90210]) {
    it(`holds after a random sequence of debits, refunds and grants (seed ${seed})`, async () => {
      const random = mulberry32(seed);
      const identityId = await seedIdentity(db, 1_000);
      const steps = plan(random, 60);

      let applied = 0;
      for (const [index, step] of steps.entries()) {
        if (step.kind === "grant") {
          await grantTestCredits(db, identityId, step.credits, `seed${seed}:grant:${index}`);
          applied += 1;
          continue;
        }
        const usageEventId = await seedUsageEvent(db, identityId, step.credits);
        if (step.kind === "debit") {
          const result = await debitCredits(db, { identityId, credits: step.credits, usageEventId });
          // An insufficient balance writes nothing; it is a valid outcome here.
          if (result.ok) applied += 1;
          continue;
        }
        const refund = await refundCredits(db, { identityId, credits: step.credits, usageEventId });
        expect(refund.ok).toBe(true);
        applied += 1;
      }

      const balance = await getBalance(db, identityId);
      const sum = await ledgerSum(db, identityId);
      const last = await lastEntry(db, identityId);

      expect(balance).not.toBeNull();
      expect(sum).toBe(balance);
      expect(last?.balanceAfter).toBe(balance);
      // The seeding grant plus every applied step wrote exactly one entry each.
      const entries = await db
        .select()
        .from(creditLedger)
        .where(eq(creditLedger.identityId, identityId));
      expect(entries).toHaveLength(applied + 1);
      expect(balance).toBeGreaterThanOrEqual(0n);
    });
  }

  it("keeps every identity's balance equal to its own ledger sum", async () => {
    const random = mulberry32(2024);
    const ids = [
      await seedIdentity(db, 300),
      await seedIdentity(db, 300),
      await seedIdentity(db, 300),
    ];

    for (let i = 0; i < 40; i += 1) {
      const identityId = ids[Math.floor(random() * ids.length)];
      if (identityId === undefined) throw new Error("no identity picked");
      const credits = 1 + Math.floor(random() * 30);
      const usageEventId = await seedUsageEvent(db, identityId, credits);
      await debitCredits(db, { identityId, credits, usageEventId });
    }

    for (const identityId of ids) {
      expect(await ledgerSum(db, identityId)).toBe(await getBalance(db, identityId));
    }
  });
});
