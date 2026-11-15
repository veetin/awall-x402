import { describe, expect, it } from "vitest";
import { RouteTable } from "../src/match.js";
import { policySchema } from "../src/types.js";

const table = new RouteTable(
  policySchema.parse({
    origin: "http://localhost:8787",
    free_tier: { window_seconds: 60, credits: 100, burst: 30 },
    pricing: {
      pack_credits: 10000,
      price_usdc: "0.50",
      price_brl_cents: 290,
      max_multiplier: 3,
    },
    routes: [
      { match: "GET /v1/search", credits: 1 },
      { match: "GET /v1/items/*", credits: 2 },
      { match: "POST /v1/completions", credits: 50, metered: true },
    ],
  }),
);

describe("RouteTable", () => {
  it("matches an exact path", () => {
    expect(table.find("GET", "/v1/search")?.credits).toBe(1);
  });

  it("matches a wildcard prefix", () => {
    expect(table.find("get", "/v1/items/42")?.credits).toBe(2);
  });

  it("keeps the metered flag", () => {
    expect(table.find("POST", "/v1/completions")?.metered).toBe(true);
  });

  it("does not match a different method or an unknown path", () => {
    expect(table.find("POST", "/v1/search")).toBeUndefined();
    expect(table.find("GET", "/v1/unknown")).toBeUndefined();
  });
});
