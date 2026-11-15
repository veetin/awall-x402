import { describe, expect, it } from "vitest";
import { decide, SHARED_SCOPE } from "../src/decide.js";
import { RouteTable } from "../src/match.js";
import { policySchema } from "../src/types.js";

function build(raw: unknown) {
  const policy = policySchema.parse(raw);
  return { policy, routes: new RouteTable(policy) };
}

const base = {
  origin: "http://localhost:8787",
  free_tier: { window_seconds: 60, credits: 100, burst: 20 },
  pricing: {
    pack_credits: 10000,
    price_usdc: "0.50",
    price_brl_cents: 290,
    max_multiplier: 3,
  },
};

describe("decide", () => {
  it("denies an unlisted route by default", () => {
    const { policy, routes } = build({
      ...base,
      routes: [{ match: "GET /v1/search", credits: 1 }],
    });
    expect(decide(policy, routes, "GET", "/v1/other")).toEqual({
      kind: "deny",
      reason: "route_not_configured",
    });
  });

  it("can let unlisted routes through for free", () => {
    const { policy, routes } = build({
      ...base,
      defaults: { unmatched: "free" },
      routes: [{ match: "GET /v1/search", credits: 1 }],
    });
    expect(decide(policy, routes, "GET", "/v1/other").kind).toBe("free");
  });

  it("can charge unlisted routes a default cost", () => {
    const { policy, routes } = build({
      ...base,
      defaults: { unmatched: "charge", credits: 3 },
      routes: [{ match: "GET /v1/search", credits: 1 }],
    });
    const decision = decide(policy, routes, "GET", "/v1/other");
    expect(decision).toMatchObject({ kind: "charge", credits: 3, scope: SHARED_SCOPE });
  });

  it("never charges a free route", () => {
    const { policy, routes } = build({
      ...base,
      routes: [
        { match: "GET /healthz", free: true },
        { match: "GET /v1/search", credits: 1 },
      ],
    });
    expect(decide(policy, routes, "GET", "/healthz").kind).toBe("free");
  });

  it("gives a route with its own free_tier a separate bucket scope", () => {
    const { policy, routes } = build({
      ...base,
      routes: [
        { match: "GET /v1/search", credits: 1 },
        {
          match: "GET /v1/reports/*",
          credits: 20,
          free_tier: { window_seconds: 3600, credits: 100 },
        },
      ],
    });

    const shared = decide(policy, routes, "GET", "/v1/search");
    const own = decide(policy, routes, "GET", "/v1/reports/2026-11");

    expect(shared).toMatchObject({ scope: SHARED_SCOPE, limits: { capacity: 120 } });
    expect(own).toMatchObject({
      scope: "GET /v1/reports/*",
      credits: 20,
      limits: { capacity: 100 },
    });
    // 100 credits per hour, not per minute.
    expect(own.kind === "charge" && own.limits.refillPerSecond).toBeCloseTo(100 / 3600, 10);
  });

  it("rejects a route with neither credits nor free", () => {
    expect(() =>
      build({ ...base, routes: [{ match: "GET /v1/search" }] }),
    ).toThrow();
  });

  it("rejects a free route that also declares a quota", () => {
    expect(() =>
      build({
        ...base,
        routes: [
          {
            match: "GET /healthz",
            free: true,
            free_tier: { window_seconds: 60, credits: 10 },
          },
        ],
      }),
    ).toThrow();
  });
});
