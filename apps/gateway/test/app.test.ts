import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPolicy, policySchema } from "@awall/policy";
import { decodeHeader } from "@awall/settlement";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createTestDb } from "./db.js";

const config = readConfig({
  AWALL_PORT: "8402",
  STELLAR_PAY_TO: "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
} as NodeJS.ProcessEnv);
const policy = loadPolicy(new URL("./fixtures/awall.test.yaml", import.meta.url).pathname);

/** Policy fixture: 4 credits of free quota, 2 credits per call. */
const CALLS_IN_FREE_QUOTA = 2;

async function app() {
  return createApp(config, policy, { db: await createTestDb() });
}

const freeRoutePolicy = policySchema.parse({
  origin: "http://127.0.0.1:59999",
  free_tier: { window_seconds: 60, credits: 4, burst: 0 },
  pricing: {
    pack_credits: 10000,
    price_usdc: "0.50",
    price_xlm: "5.00",
    price_brl_cents: 290,
    max_multiplier: 3.0,
  },
  routes: [
    { match: "GET /v1/health", free: true },
    { match: "GET /v1/search", credits: 2 },
    {
      match: "GET /v1/reports/*",
      credits: 2,
      free_tier: { window_seconds: 3600, credits: 2 },
    },
  ],
});

const unmatchedFreePolicy = policySchema.parse({
  ...freeRoutePolicy,
  defaults: { unmatched: "free", credits: 1 },
});

/** Replace the origin with a fixed response, so no socket is needed. */
function stubOrigin(status: number): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ ok: status < 400 }), { status })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("gateway", () => {
  it("rejects a route that is not in the policy", async () => {
    const res = await (await app()).request("/v1/unknown");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "route_not_configured" });
  });

  it("serves requests inside the free quota and reports the cost", async () => {
    stubOrigin(200);
    const res = await (await app()).request("/v1/search", { headers: { "x-api-key": "free-key" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-AWall-Cost-Credits")).toBe("2");
    expect(res.headers.get("X-AWall-Free-Remaining-Credits")).toBe("2");
  });

  it("answers 402, not 429, once the free quota is spent", async () => {
    stubOrigin(200);
    const gateway = (await app());
    const headers = { "x-api-key": "spender-key" };
    for (let i = 0; i < CALLS_IN_FREE_QUOTA; i += 1) {
      expect((await gateway.request("/v1/search", { headers })).status).toBe(200);
    }

    const res = await gateway.request("/v1/search", { headers });
    expect(res.status).toBe(402);
    expect(res.headers.get("Retry-After")).toBe("2");
    expect(res.headers.get("X-AWall-Price-Multiplier")).toBe("1.00");
  });

  it("advertises both rails in the PAYMENT-REQUIRED header", async () => {
    stubOrigin(200);
    const gateway = (await app());
    const headers = { "x-api-key": "rails-key" };
    for (let i = 0; i < CALLS_IN_FREE_QUOTA; i += 1) {
      await gateway.request("/v1/search", { headers });
    }

    const res = await gateway.request("/v1/search", { headers });
    expect(res.status).toBe(402);

    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const decoded = decodeHeader(header as string);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const required = decoded.value as {
      x402Version: number;
      accepts: Record<string, unknown>[];
    };

    expect(required.x402Version).toBe(2);
    const [usdc, xlm, pix] = required.accepts;
    expect(usdc).toMatchObject({
      scheme: "exact",
      network: "stellar:testnet",
      amount: "5000000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      extra: { areFeesSponsored: true, packCredits: 10000, assetCode: "USDC" },
    });
    expect(xlm).toMatchObject({
      scheme: "exact",
      network: "stellar:testnet",
      amount: "50000000",
      asset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      extra: { areFeesSponsored: true, packCredits: 10000, assetCode: "XLM" },
    });
    expect(pix).toMatchObject({
      scheme: "pix",
      network: "pix:bcb",
      asset: "BRL",
      amount: "290",
      payTo: "merchant",
    });

    // The body mirrors the header, for debugging and for clients that ignore it.
    await expect(res.json()).resolves.toMatchObject({ x402Version: 2 });
  });

  it("exposes the offer as pending until it is paid", async () => {
    stubOrigin(200);
    const gateway = (await app());
    const headers = { "x-api-key": "offer-key" };
    for (let i = 0; i < CALLS_IN_FREE_QUOTA; i += 1) {
      await gateway.request("/v1/search", { headers });
    }
    const decoded = decodeHeader(
      (await gateway.request("/v1/search", { headers })).headers.get("PAYMENT-REQUIRED") as string,
    );
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    const required = decoded.value;
    const accepts = required["accepts"] as { extra: { offerId: string } }[];
    const offerId = accepts[0]?.extra.offerId ?? "";

    const status = await gateway.request(`/awall/offers/${offerId}`);
    expect(status.status).toBe(202);
    await expect(status.json()).resolves.toMatchObject({ status: "pending" });

    const missing = await gateway.request("/awall/offers/ofr_nope");
    expect(missing.status).toBe(404);
  });

  it("answers 402, not 500, when a payment cannot be verified", async () => {
    const res = await (await app()).request("/v1/search", {
      headers: { "x-api-key": "payer-key", "payment-signature": "e30=" },
    });
    expect(res.status).toBe(402);
    await expect(res.json()).resolves.toMatchObject({ errorReason: "invalid_payload" });
  });

  it("gives quota back when the origin fails", async () => {
    stubOrigin(500);
    const gateway = (await app());
    const headers = { "x-api-key": "refund-key" };
    // Every call fails upstream and is refunded, so quota never runs out.
    for (let i = 0; i < CALLS_IN_FREE_QUOTA + 2; i += 1) {
      const res = await gateway.request("/v1/search", { headers });
      expect(res.status).toBe(500);
      expect(res.headers.get("X-AWall-Free-Remaining-Credits")).toBe("4");
    }
  });

  it("answers 502 when the origin is unreachable, and refunds", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );
    const res = await (await app()).request("/v1/search", { headers: { "x-api-key": "down-key" } });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "origin_unreachable" });
  });
});

describe("identity behind an edge proxy", () => {
  const forwarded = { "x-forwarded-for": "203.0.113.7, 10.0.0.1" };

  it("ignores X-Forwarded-For by default", async () => {
    stubOrigin(200);
    const res = await (await app()).request("/v1/search", { headers: forwarded });
    expect(res.headers.get("X-AWall-Identity")).toBe(
      (
        await (await app()).request("/v1/search", {
          headers: { "x-forwarded-for": "198.51.100.9" },
        })
      ).headers.get("X-AWall-Identity"),
    );
  });

  it("separates identities per forwarded address when the proxy is trusted", async () => {
    stubOrigin(200);
    const trusting = createApp({ ...config, trustProxy: true }, policy, { db: await createTestDb() });
    const first = await trusting.request("/v1/search", { headers: forwarded });
    const second = await trusting.request("/v1/search", {
      headers: { "x-forwarded-for": "198.51.100.9" },
    });
    expect(first.headers.get("X-AWall-Identity")).not.toBe(
      second.headers.get("X-AWall-Identity"),
    );
  });
});

describe("per-route configuration", () => {
  it("serves a free route without touching the quota", async () => {
    stubOrigin(200);
    const gateway = createApp(config, freeRoutePolicy, { db: await createTestDb() });
    for (let i = 0; i < 20; i += 1) {
      const res = await gateway.request("/v1/health", { headers: { "x-api-key": "k" } });
      expect(res.status).toBe(200);
      expect(res.headers.get("X-AWall-Cost-Credits")).toBe("0");
    }
  });

  it("keeps a route with its own quota separate from the shared one", async () => {
    stubOrigin(200);
    const gateway = createApp(config, freeRoutePolicy, { db: await createTestDb() });
    const headers = { "x-api-key": "scoped-key" };

    // The report route has 2 credits of its own and costs 2: one call, then 402.
    expect((await gateway.request("/v1/reports/2026-11", { headers })).status).toBe(200);
    expect((await gateway.request("/v1/reports/2026-11", { headers })).status).toBe(402);

    // The shared quota is untouched, so the search route still answers.
    const search = await gateway.request("/v1/search", { headers });
    expect(search.status).toBe(200);
    expect(search.headers.get("X-AWall-Quota-Scope")).toBe("shared");
  });

  it("proxies unlisted routes when defaults say free", async () => {
    stubOrigin(200);
    const gateway = createApp(config, unmatchedFreePolicy, { db: await createTestDb() });
    const res = await gateway.request("/v1/anything", { headers: { "x-api-key": "k" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-AWall-Cost-Credits")).toBe("0");
  });
});
