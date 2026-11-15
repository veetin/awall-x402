import { describe, expect, it } from "vitest";
import { loadPolicy } from "../src/load.js";
import { priceFor } from "../src/price.js";

/** The policy shipped in the repository must stay loadable and priced correctly. */
describe("awall.yaml", () => {
  const policy = loadPolicy(new URL("../../../awall.yaml", import.meta.url).pathname);

  it("loads and keeps the origin and the free tier", () => {
    expect(policy.origin).toBe("http://localhost:8787");
    expect(policy.free_tier.credits).toBeGreaterThan(0);
  });

  it("prices the pack with 7 decimals", () => {
    // Guards the EVM-decimals mistake: "0.50" is 5000000, never 500000.
    expect(priceFor(policy, 0).usdcAtomic).toBe("5000000");
  });

  it("rejects an unknown field, so drift fails loudly", () => {
    expect(() => loadPolicy(new URL("../../../package.json", import.meta.url).pathname)).toThrow(
      /invalid policy/,
    );
  });
});
