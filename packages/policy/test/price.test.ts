import { describe, expect, it } from "vitest";
import { abuseMultiplier, decimalToAtomic, priceFor } from "../src/price.js";
import { policySchema } from "../src/types.js";

const policy = policySchema.parse({
  origin: "http://localhost:8787",
  free_tier: { window_seconds: 60, credits: 100, burst: 30 },
  pricing: {
    pack_credits: 10000,
    price_usdc: "0.50",
    price_brl_cents: 290,
    max_multiplier: 3.0,
  },
  routes: [{ match: "GET /v1/search", credits: 1 }],
});

describe("decimalToAtomic", () => {
  it("uses 7 decimals, not 6", () => {
    expect(decimalToAtomic("0.50")).toBe(5_000_000n);
    expect(decimalToAtomic("1")).toBe(10_000_000n);
    expect(decimalToAtomic("0.0000001")).toBe(1n);
  });

  it("rejects more precision than the asset has", () => {
    expect(() => decimalToAtomic("0.00000001")).toThrow(/more than 7 decimals/);
  });

  it("rejects values that are not plain decimals", () => {
    expect(() => decimalToAtomic("1e7")).toThrow(/not a decimal amount/);
    expect(() => decimalToAtomic("-1")).toThrow(/not a decimal amount/);
  });
});

describe("abuseMultiplier", () => {
  it("is 1 for a clean identity and the ceiling for the worst", () => {
    expect(abuseMultiplier(0, 3)).toBe(1);
    expect(abuseMultiplier(1, 3)).toBe(3);
  });

  it("clamps out-of-range and non-finite scores", () => {
    expect(abuseMultiplier(-5, 3)).toBe(1);
    expect(abuseMultiplier(9, 3)).toBe(3);
    expect(abuseMultiplier(Number.NaN, 3)).toBe(1);
  });
});

describe("priceFor", () => {
  it("prices the base pack", () => {
    const price = priceFor(policy, 0);
    expect(price).toMatchObject({ usdcAtomic: "5000000", brlCents: 290, packCredits: 10000 });
  });

  it("applies the abuse multiplier to both rails", () => {
    const price = priceFor(policy, 0.18);
    expect(price.multiplier).toBeCloseTo(1.36, 10);
    expect(price.usdcAtomic).toBe("6800000");
    expect(price.brlCents).toBe(394);
  });
});
