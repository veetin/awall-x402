import { describe, expect, it } from "vitest";
import { abuseMultiplier, priceFor } from "../src/price.js";
import { abuseScoreOf, initialAbuseState, observeAbuse } from "../src/abuse.js";
import { policySchema } from "../src/types.js";

const policy = policySchema.parse({
  origin: "http://localhost:8787",
  free_tier: { window_seconds: 60, credits: 100, burst: 0 },
  pricing: { pack_credits: 10000, price_usdc: "0.50", price_xlm: "5.00", price_brl_cents: 290, max_multiplier: 3 },
  routes: [{ match: "GET /v1/search", credits: 1 }],
});

function drive(
  mode: "polite" | "abusive",
  steps: number,
): ReturnType<typeof abuseScoreOf> {
  let state = initialAbuseState();
  let at = 1_000_000;
  for (let i = 0; i < steps; i += 1) {
    at += mode === "polite" ? 800 : 10;
    state = observeAbuse(state, {
      now: at,
      requestHash: mode === "polite" ? `hash-${i}` : "same",
      originStatus: mode === "polite" ? 200 : 404,
      ignoresCacheValidators: mode === "abusive",
    });
  }
  return abuseScoreOf(state);
}

describe("abuse score", () => {
  it("prices a burst of identical failing requests above a steady client, and caps the multiplier", () => {
    const polite = drive("polite", 20);
    const abusive = drive("abusive", 20);
    expect(abusive).toBeGreaterThan(polite);
    expect(abusive).toBeLessThanOrEqual(1);
    const politePrice = priceFor(policy, polite);
    const abusivePrice = priceFor(policy, abusive);
    expect(BigInt(abusivePrice.usdcAtomic)).toBeGreaterThan(BigInt(politePrice.usdcAtomic));
    expect(abusivePrice.multiplier).toBeLessThanOrEqual(policy.pricing.max_multiplier);
    expect(abusivePrice.multiplier).toBeCloseTo(abuseMultiplier(abusive, 3), 5);
  });
});
