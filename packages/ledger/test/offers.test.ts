import { beforeEach, describe, expect, it } from "vitest";
import { createOffer, getOffer, markOfferPaid, OFFER_TTL_MS } from "../src/index.js";
import { createTestDb, seedIdentity, type TestDb } from "./helpers/db.js";

const TERMS = {
  packCredits: 10_000,
  priceUsdcAtomic: "5000000",
  priceBrlCents: 250,
  multiplier: 1.5,
  network: "stellar:testnet",
  asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
  payTo: "GA7QYNF7SOWQ3GLR2BGMZEHXAVIRZA4KVWLTJJFC7MGXUA74P7UJVSGZ",
  rails: ["exact" as const, "pix" as const],
};

describe("offers", () => {
  let db: TestDb;

  beforeEach(async () => {
    db = await createTestDb();
  });

  it("stores the terms as issued, money as integer strings", async () => {
    const identityId = await seedIdentity(db);
    const now = new Date("2026-11-30T12:00:00.000Z");

    const offer = await createOffer(db, { identityId, ...TERMS, now });

    expect(offer.id).toMatch(/^ofr_/);
    expect(offer.status).toBe("pending");
    // 0.50 USDC with 7 decimals, kept as a string.
    expect(offer.priceUsdcAtomic).toBe("5000000");
    expect(offer.priceBrlCents).toBe(250);
    expect(offer.rails).toEqual(["exact", "pix"]);
    expect(offer.expiresAt.getTime()).toBe(now.getTime() + OFFER_TTL_MS);
    expect(await getOffer(db, offer.id, now)).toMatchObject({ id: offer.id, status: "pending" });
  });

  it("expires a pending offer past its deadline, on the server clock", async () => {
    const identityId = await seedIdentity(db);
    const now = new Date("2026-11-30T12:00:00.000Z");
    const offer = await createOffer(db, { identityId, ...TERMS, now });

    const later = new Date(now.getTime() + OFFER_TTL_MS + 1);
    expect((await getOffer(db, offer.id, later))?.status).toBe("expired");

    const result = await markOfferPaid(db, offer.id);
    expect(result).toMatchObject({ ok: false, reason: "not_pending" });
  });

  it("moves a pending offer to paid, once", async () => {
    const identityId = await seedIdentity(db);
    const offer = await createOffer(db, { identityId, ...TERMS });

    const first = await markOfferPaid(db, offer.id);
    const second = await markOfferPaid(db, offer.id);

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: false, reason: "not_pending" });
    expect((await getOffer(db, offer.id))?.status).toBe("paid");
  });

  it("reports an unknown offer", async () => {
    expect(await getOffer(db, "ofr_missing")).toBeNull();
    expect(await markOfferPaid(db, "ofr_missing")).toEqual({
      ok: false,
      reason: "unknown_offer",
      offer: null,
    });
  });
});
