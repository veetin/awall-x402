import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  creditLedger,
  debitCredits,
  getBalance,
  ledgerSum,
  refundCredits,
} from "../src/index.js";
import { createTestDb, seedIdentity, seedUsageEvent, type TestDb } from "./helpers/db.js";

describe("debitCredits", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("charges the route cost and writes one ledger entry", async () => {
    const identityId = await seedIdentity(db, 100);
    const usageEventId = await seedUsageEvent(db, identityId, 30);

    const result = await debitCredits(db, { identityId, credits: 30, usageEventId });

    expect(result).toMatchObject({ ok: true, balanceAfter: 70n });
    expect(await getBalance(db, identityId)).toBe(70n);
    const entries = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.reason, "debit"));
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      deltaCredits: -30n,
      balanceAfter: 70n,
      usageEventId,
      paymentId: null,
    });
  });

  it("writes nothing when the balance is insufficient", async () => {
    const identityId = await seedIdentity(db, 10);
    const usageEventId = await seedUsageEvent(db, identityId, 50);
    const entriesBefore = await db.select().from(creditLedger);

    const result = await debitCredits(db, { identityId, credits: 50, usageEventId });

    expect(result).toEqual({ ok: false, reason: "insufficient_credits", balance: 10n });
    expect(await getBalance(db, identityId)).toBe(10n);
    expect(await ledgerSum(db, identityId)).toBe(10n);
    expect(await db.select().from(creditLedger)).toHaveLength(entriesBefore.length);
  });

  it("reports an unknown identity instead of throwing", async () => {
    const result = await debitCredits(db, { identityId: "idt_missing", credits: 1 });
    expect(result).toEqual({ ok: false, reason: "unknown_identity", balance: 0n });
  });

  it("rejects a non-positive amount", async () => {
    const identityId = await seedIdentity(db, 100);
    await expect(debitCredits(db, { identityId, credits: 0 })).rejects.toThrow(RangeError);
    await expect(debitCredits(db, { identityId, credits: -5 })).rejects.toThrow(RangeError);
  });
});

describe("refundCredits", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("gives the credits back after an origin 5xx", async () => {
    const identityId = await seedIdentity(db, 100);
    const usageEventId = await seedUsageEvent(db, identityId, 40);
    await debitCredits(db, { identityId, credits: 40, usageEventId });

    const result = await refundCredits(db, { identityId, credits: 40, usageEventId });

    expect(result).toMatchObject({ ok: true, balanceAfter: 100n });
    expect(await getBalance(db, identityId)).toBe(100n);
    expect(await ledgerSum(db, identityId)).toBe(100n);
    const refunds = await db
      .select()
      .from(creditLedger)
      .where(eq(creditLedger.reason, "refund"));
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({ deltaCredits: 40n, usageEventId });
  });
});
