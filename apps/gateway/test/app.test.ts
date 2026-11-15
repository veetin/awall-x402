import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPolicy } from "@awall/policy";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { decodeHeader } from "../src/x402.js";
import type { PaymentRequired } from "../src/x402.js";

const config = readConfig({
  AWALL_PORT: "8402",
  STELLAR_PAY_TO: "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
} as NodeJS.ProcessEnv);
const policy = loadPolicy(new URL("./fixtures/awall.test.yaml", import.meta.url).pathname);

/** Policy fixture: 4 credits of free quota, 2 credits per call. */
const CALLS_IN_FREE_QUOTA = 2;

function app() {
  return createApp(config, policy);
}

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
    const res = await app().request("/v1/unknown");
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ error: "route_not_configured" });
  });

  it("serves requests inside the free quota and reports the cost", async () => {
    stubOrigin(200);
    const res = await app().request("/v1/search", { headers: { "x-api-key": "free-key" } });
    expect(res.status).toBe(200);
    expect(res.headers.get("X-AWall-Cost-Credits")).toBe("2");
    expect(res.headers.get("X-AWall-Free-Remaining-Credits")).toBe("2");
  });

  it("answers 402, not 429, once the free quota is spent", async () => {
    stubOrigin(200);
    const gateway = app();
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
    const gateway = app();
    const headers = { "x-api-key": "rails-key" };
    for (let i = 0; i < CALLS_IN_FREE_QUOTA; i += 1) {
      await gateway.request("/v1/search", { headers });
    }

    const res = await gateway.request("/v1/search", { headers });
    expect(res.status).toBe(402);

    const header = res.headers.get("PAYMENT-REQUIRED");
    expect(header).toBeTruthy();
    const required = decodeHeader<PaymentRequired>(header as string);

    expect(required.x402Version).toBe(2);
    const [exact, pix] = required.accepts;
    expect(exact).toMatchObject({
      scheme: "exact",
      network: "stellar:testnet",
      amount: "5000000",
      asset: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA",
      extra: { areFeesSponsored: true, packCredits: 10000 },
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
    const gateway = app();
    const headers = { "x-api-key": "offer-key" };
    for (let i = 0; i < CALLS_IN_FREE_QUOTA; i += 1) {
      await gateway.request("/v1/search", { headers });
    }
    const required = decodeHeader<PaymentRequired>(
      (await gateway.request("/v1/search", { headers })).headers.get(
        "PAYMENT-REQUIRED",
      ) as string,
    );
    const offerId = (required.accepts[0]?.extra as { offerId: string }).offerId;

    const status = await gateway.request(`/awall/offers/${offerId}`);
    expect(status.status).toBe(202);
    await expect(status.json()).resolves.toMatchObject({ status: "pending" });

    const missing = await gateway.request("/awall/offers/ofr_nope");
    expect(missing.status).toBe(404);
  });

  it("refuses a payment it cannot verify yet instead of faking success", async () => {
    const res = await app().request("/v1/search", {
      headers: { "x-api-key": "payer-key", "payment-signature": "e30=" },
    });
    expect(res.status).toBe(501);
    await expect(res.json()).resolves.toMatchObject({
      error: "payment_verification_not_implemented",
    });
  });

  it("gives quota back when the origin fails", async () => {
    stubOrigin(500);
    const gateway = app();
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
    const res = await app().request("/v1/search", { headers: { "x-api-key": "down-key" } });
    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toMatchObject({ error: "origin_unreachable" });
  });
});
