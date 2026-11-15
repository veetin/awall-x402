import { beforeEach, describe, expect, it } from "vitest";
import { debitCredits, getBalance, ledgerSum } from "../src/index.js";
import { createTestDb, seedIdentity, seedUsageEvent, type TestDb } from "./helpers/db.js";

/**
 * PGlite is a single connection, so these debits are serialized by its own
 * transaction queue rather than by `SELECT … FOR UPDATE`. The test still pins the
 * outcome the lock has to produce: no debit ever reads a balance it does not
 * then own, so the balance never goes negative and the ledger stays consistent.
 * Contention against a real Postgres server is not covered here.
 */
describe("concurrent debits of the same identity", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("never drives the balance negative", async () => {
    const identityId = await seedIdentity(db, 100);
    const cost = 30;
    const attempts = 10;
    const usageEventIds = await Promise.all(
      Array.from({ length: attempts }, () => seedUsageEvent(db, identityId, cost)),
    );

    const results = await Promise.all(
      usageEventIds.map((usageEventId) =>
        debitCredits(db, { identityId, credits: cost, usageEventId }),
      ),
    );

    const charged = results.filter((result) => result.ok);
    const rejected = results.filter((result) => !result.ok);
    // 100 credits at 30 each: three debits fit, the rest get a 402.
    expect(charged).toHaveLength(3);
    expect(rejected).toHaveLength(attempts - 3);
    for (const result of rejected) {
      expect(result).toMatchObject({ ok: false, reason: "insufficient_credits" });
    }

    const balance = await getBalance(db, identityId);
    expect(balance).toBe(10n);
    expect(balance).toBeGreaterThanOrEqual(0n);
    expect(await ledgerSum(db, identityId)).toBe(balance);
  });

  it("charges every credit exactly once when the balance divides evenly", async () => {
    const identityId = await seedIdentity(db, 120);
    const usageEventIds = await Promise.all(
      Array.from({ length: 12 }, () => seedUsageEvent(db, identityId, 20)),
    );

    const results = await Promise.all(
      usageEventIds.map((usageEventId) =>
        debitCredits(db, { identityId, credits: 20, usageEventId }),
      ),
    );

    expect(results.filter((result) => result.ok)).toHaveLength(6);
    expect(await getBalance(db, identityId)).toBe(0n);
    expect(await ledgerSum(db, identityId)).toBe(0n);
  });
});
