import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createOffer,
  getBalance,
  getOffer,
  grantCredits,
  ledgerSum,
  payments,
} from "../src/index.js";
import type { Database } from "../src/db.js";
import { createTestDb, seedIdentity, type TestDb } from "./helpers/db.js";

const OFFER = {
  packCredits: 10_000,
  // 0.50 USDC with 7 decimals. An EVM example (6 decimals) would be off by 10x.
  priceUsdcAtomic: "5000000",
  priceXlmAtomic: "50000000",
  priceBrlCents: 250,
  multiplier: 1,
  network: "stellar:testnet",
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  xlmAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
  payTo: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
  rails: ["exact" as const],
};

async function newOffer(db: Database, identityId: string) {
  return createOffer(db, { identityId, ...OFFER });
}

describe("grantCredits idempotency", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("credits once when called twice with the same idempotency key", async () => {
    const identityId = await seedIdentity(db);
    const offer = await newOffer(db, identityId);
    const payment = {
      rail: "exact" as const,
      amount: offer.priceUsdcAtomic,
      asset: offer.asset,
      network: offer.network,
      idempotencyKey: "b".repeat(64),
      txHash: "b".repeat(64),
      payer: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
    };

    const first = await grantCredits(db, {
      identityId,
      offerId: offer.id,
      credits: offer.packCredits,
      payment,
    });
    const second = await grantCredits(db, {
      identityId,
      offerId: offer.id,
      credits: offer.packCredits,
      payment,
    });

    expect(first.credited).toBe(true);
    expect(first.alreadyProcessed).toBe(false);
    expect(second.credited).toBe(false);
    expect(second.alreadyProcessed).toBe(true);
    // The replay answers with the result of the original processing.
    expect(second.paymentId).toBe(first.paymentId);
    expect(second.balanceAfter).toBe(first.balanceAfter);
    expect(second.entryId).toBe(first.entryId);

    expect(await getBalance(db, identityId)).toBe(BigInt(offer.packCredits));
    expect(await ledgerSum(db, identityId)).toBe(BigInt(offer.packCredits));
    const rows = await db.select().from(payments).where(eq(payments.offerId, offer.id));
    expect(rows).toHaveLength(1);
  });

  it("marks the offer paid in the same transaction as the credit", async () => {
    const identityId = await seedIdentity(db);
    const offer = await newOffer(db, identityId);

    await grantCredits(db, {
      identityId,
      offerId: offer.id,
      credits: offer.packCredits,
      payment: {
        rail: "pix",
        amount: String(offer.priceBrlCents),
        asset: "BRL",
        network: "pix",
        idempotencyKey: "pix:chr_abc123",
      },
    });

    expect((await getOffer(db, offer.id))?.status).toBe("paid");
  });

  it("records a failed payment without crediting", async () => {
    const identityId = await seedIdentity(db);
    const offer = await newOffer(db, identityId);

    const result = await grantCredits(db, {
      identityId,
      offerId: offer.id,
      credits: offer.packCredits,
      payment: {
        rail: "exact",
        amount: offer.priceUsdcAtomic,
        asset: offer.asset,
        network: offer.network,
        idempotencyKey: "c".repeat(64),
        status: "failed",
        errorReason: "insufficient_funds",
      },
    });

    expect(result.credited).toBe(false);
    expect(await getBalance(db, identityId)).toBe(0n);
    expect(await ledgerSum(db, identityId)).toBe(0n);
    expect((await getOffer(db, offer.id))?.status).toBe("pending");
  });
});
