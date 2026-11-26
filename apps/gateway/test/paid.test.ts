import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createOffer,
  getBalance,
  grantCredits,
  listLedgerEntries,
  listUsageRollups,
  purgeUsageEvents,
  recordUsageEvent,
} from "@awall/ledger";
import { AbacatePayClient } from "@awall/pix";
import { policySchema } from "@awall/policy";
import { FacilitatorClient, decodeHeader, encodeHeader } from "@awall/settlement";
import { createApp } from "../src/app.js";
import { PIX_LATE_CONFIRM_MS } from "../src/pix-flow.js";
import { readConfig } from "../src/config.js";
import { createTestDb } from "./db.js";

const config = readConfig({
  AWALL_PORT: "8402",
  STELLAR_PAY_TO: "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
  AWALL_ADMIN_TOKEN: "admin-secret",
  AWALL_CONSOLE_ORIGIN: "http://localhost:4179",
  ABACATEPAY_WEBHOOK_SECRET: "whsec_test",
} as NodeJS.ProcessEnv);

const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const TX = "ab".repeat(32);

function facilitator(handler: (path: string) => unknown) {
  return new FacilitatorClient({
    baseUrl: "http://facilitator.test",
    fetch: async (url) => {
      const path = new URL(url).pathname;
      const body = handler(path);
      if (body === "down") throw new TypeError("connect ECONNREFUSED");
      if (body === "garbage") return new Response("not-json", { status: 200 });
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("settlement", () => {
  it("credits when the client pays in XLM instead of USDC", async () => {
    const db = await createTestDb();
    const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const calls: string[] = [];
    const app = createApp(config, policySchema.parse(basePolicy()), {
      db,
      facilitator: facilitator((path) => {
        calls.push(path);
        if (path.endsWith("/verify")) return { isValid: true, payer: "GBUYER" };
        return { success: true, transaction: "xlm-tx", network: "stellar:testnet", payer: "GBUYER" };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const exhausted = await exhaust(app, "xlm-payer");
    const xlm = exhausted.accepts.find((item) => item.asset === XLM);
    expect(xlm?.amount).toBeTruthy();
    const paid = await app.request("/v1/search", {
      headers: {
        "x-api-key": "xlm-payer",
        "payment-signature": signature(exhausted.offerId, xlm?.amount ?? "", XLM),
      },
    });
    expect(paid.status).toBe(200);
    expect(paid.headers.get("X-AWall-Credits-Remaining")).toBe("9998");
    expect(await getBalance(db, exhausted.identityId)).toBe(9998n);
    expect(calls).toEqual(["/verify", "/settle"]);
  });

  it("credits the offer amount, serves the request, and ignores a cheaper payload", async () => {
    const db = await createTestDb();
    const calls: string[] = [];
    const app = createApp(config, policySchema.parse(basePolicy()), {
      db,
      facilitator: facilitator((path) => {
        calls.push(path);
        if (path.endsWith("/verify")) return { isValid: true, payer: "GBUYER" };
        return { success: true, transaction: TX, network: "stellar:testnet", payer: "GBUYER" };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));

    const { offerId, identityId, amount } = await exhaust(app);
    const underpaid = await app.request("/v1/search", {
      headers: {
        "x-api-key": "payer",
        "payment-signature": signature(offerId, "1"),
      },
    });
    expect(underpaid.status).toBe(402);
    await expect(underpaid.json()).resolves.toMatchObject({ errorReason: "invalid_payment_requirements" });
    expect(await getBalance(db, identityId)).toBe(0n);

    const paid = await app.request("/v1/search", {
      headers: { "x-api-key": "payer", "payment-signature": signature(offerId, amount) },
    });
    expect(paid.status).toBe(200);
    expect(paid.headers.get("PAYMENT-RESPONSE")).toBeTruthy();
    expect(paid.headers.get("X-AWall-Credits-Remaining")).toBe("9998");
    expect(calls).toEqual(["/verify", "/settle"]);

    const restarted = createApp(config, policySchema.parse(basePolicy()), { db });
    const again = await restarted.request("/awall/offers/" + offerId);
    expect(again.status).toBe(200);
    expect(await getBalance(db, identityId)).toBe(9998n);
  });

  it("does not credit when the facilitator is down, malformed, or still pending", async () => {
    const db = await createTestDb();
    let mode: "down" | "garbage" | "pending" | "settled" = "down";
    const app = createApp(config, policySchema.parse(basePolicy()), {
      db,
      facilitator: facilitator((path) => {
        if (mode === "down") return "down";
        if (mode === "garbage") return "garbage";
        if (path.endsWith("/verify")) return { isValid: true };
        if (mode === "pending") {
          return {
            success: false,
            errorReason: "settlement_pending",
            transaction: TX,
            network: "stellar:testnet",
          };
        }
        return { success: true, transaction: TX, network: "stellar:testnet" };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { offerId, identityId: id, amount } = await exhaust(app);

    mode = "down";
    const down = await pay(app, offerId, amount);
    expect(down.status).toBe(402);
    expect(await getBalance(db, id)).toBe(0n);

    mode = "garbage";
    const garbage = await pay(app, offerId, amount);
    expect(garbage.status).toBe(402);
    expect(await getBalance(db, id)).toBe(0n);

    mode = "pending";
    const pending = await pay(app, offerId, amount);
    expect(pending.status).toBe(402);
    await expect(pending.json()).resolves.toMatchObject({ errorReason: "settlement_pending" });
    expect(await getBalance(db, id)).toBe(0n);

    mode = "settled";
    const settled = await pay(app, offerId, amount);
    expect(settled.status).toBe(200);
    expect(await getBalance(db, id)).toBe(9998n);
  });

  it("credits a transaction that settles after a terminal failure on the same hash", async () => {
    const db = await createTestDb();
    let mode: "failed" | "settled" = "failed";
    const app = createApp(config, policySchema.parse(basePolicy()), {
      db,
      facilitator: facilitator((path) => {
        if (path.endsWith("/verify")) return { isValid: true, payer: "GBUYER" };
        if (mode === "failed") {
          return {
            success: false,
            errorReason: "unexpected_settle_error",
            transaction: TX,
            network: "stellar:testnet",
          };
        }
        return { success: true, transaction: TX, network: "stellar:testnet", payer: "GBUYER" };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const { offerId, identityId, amount } = await exhaust(app);

    const refused = await pay(app, offerId, amount);
    expect(refused.status).toBe(402);
    expect(await getBalance(db, identityId)).toBe(0n);

    mode = "settled";
    const paid = await pay(app, offerId, amount);
    expect(paid.status).toBe(200);
    expect(paid.headers.get("X-AWall-Credits-Remaining")).toBe("9998");
    expect(await getBalance(db, identityId)).toBe(9998n);
  });

  it("refuses an offer that belongs to another identity, before verify", async () => {
    const db = await createTestDb();
    const calls: string[] = [];
    const app = createApp(config, policySchema.parse(basePolicy()), {
      db,
      facilitator: facilitator((path) => {
        calls.push(path);
        if (path.endsWith("/verify")) return { isValid: true, payer: "GBUYER" };
        return { success: true, transaction: TX, network: "stellar:testnet", payer: "GBUYER" };
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const mine = await exhaust(app, "owner");

    const stolen = await app.request("/v1/search", {
      headers: {
        "x-api-key": "someone-else",
        "payment-signature": signature(mine.offerId, mine.amount),
      },
    });
    expect(stolen.status).toBe(402);
    await expect(stolen.json()).resolves.toMatchObject({ error: "offer_identity_mismatch" });
    expect(calls).toEqual([]);
    expect(await getBalance(db, mine.identityId)).toBe(0n);

    const owned = await app.request("/v1/search", {
      headers: { "x-api-key": "owner", "payment-signature": signature(mine.offerId, mine.amount) },
    });
    expect(owned.status).toBe(200);
    expect(await getBalance(db, mine.identityId)).toBe(9998n);
  });

  it("serves from the credit balance once the free quota is gone", async () => {
    const db = await createTestDb();
    const app = createApp(config, policySchema.parse(basePolicy()), { db });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const first = await app.request("/v1/search", { headers: { "x-api-key": "rich" } });
    const id = first.headers.get("X-AWall-Identity") ?? "";
    const offer = await createOffer(db, {
      identityId: id,
      packCredits: 100,
      priceUsdcAtomic: "5000000",
      priceXlmAtomic: "50000000",
      priceBrlCents: 290,
      multiplier: 1,
      network: "stellar:testnet",
      asset: ASSET,
      xlmAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      payTo: config.payTo,
      rails: ["exact"],
    });
    await grantCredits(db, {
      identityId: id,
      offerId: offer.id,
      credits: 100,
      payment: {
        rail: "exact",
        amount: "5000000",
        asset: ASSET,
        network: "stellar:testnet",
        idempotencyKey: "seed-rich",
      },
    });
    await app.request("/v1/search", { headers: { "x-api-key": "rich" } });
    const served = await app.request("/v1/search", { headers: { "x-api-key": "rich" } });
    expect(served.status).toBe(200);
    expect(served.headers.get("X-AWall-Credits-Remaining")).toBe("98");
  });
});

describe("pix", () => {
  it("credits a paid charge once, including a duplicate webhook", async () => {
    const db = await createTestDb();
    const pix = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "http://pix.test",
      fetch: async (url) => {
        if (String(url).includes("/create")) {
          return json({
            success: true,
            data: {
              id: "pix_1",
              amount: 290,
              status: "PENDING",
              brCode: "000201",
              expiresAt: "2026-12-01T00:00:00.000Z",
              devMode: true,
            },
          });
        }
        return json({ success: true, data: { id: "pix_1", status: "PAID", expiresAt: null } });
      },
    });
    const app = createApp(config, policySchema.parse(basePolicy()), { db, pix });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { offerId, identityId: id } = await exhaust(app, "pix-user");

    const body = JSON.stringify({
      id: "log_1",
      event: "transparent.completed",
      apiVersion: 2,
      devMode: true,
      data: { transparent: { id: "pix_1" } },
    });
    const webhook = () =>
      app.request("/awall/webhooks/abacatepay?webhookSecret=whsec_test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
    expect((await webhook()).status).toBe(200);
    expect((await webhook()).status).toBe(200);
    expect(await getBalance(db, id)).toBe(10000n);

    const status = await app.request(`/awall/offers/${offerId}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ status: "paid", creditedCredits: 10000 });
  });
});

describe("pix after the deadline", () => {
  it("credits a charge paid in time whose webhook never arrived", async () => {
    const db = await createTestDb();
    const pix = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "http://pix.test",
      fetch: async () => json({ success: true, data: { id: "pix_late", status: "PAID", expiresAt: null } }),
    });
    const app = createApp(config, policySchema.parse(basePolicy()), { db, pix });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const first = await app.request("/v1/search", { headers: { "x-api-key": "pix-late" } });
    const identityId = first.headers.get("X-AWall-Identity") ?? "";

    const offer = await createOffer(db, {
      identityId,
      packCredits: 10000,
      priceUsdcAtomic: "5000000",
      priceXlmAtomic: "50000000",
      priceBrlCents: 290,
      multiplier: 1,
      network: "stellar:testnet",
      asset: ASSET,
      xlmAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      payTo: config.payTo,
      rails: ["pix"],
      pixChargeId: "pix_late",
      pixBrCode: "000201",
      expiresAt: new Date(Date.now() - 60_000),
    });

    const status = await app.request(`/awall/offers/${offer.id}`);
    expect(status.status).toBe(200);
    await expect(status.json()).resolves.toMatchObject({ status: "paid", creditedCredits: 10000 });
    expect(await getBalance(db, identityId)).toBe(10000n);

    const again = await app.request(`/awall/offers/${offer.id}`);
    expect(again.status).toBe(200);
    expect(await getBalance(db, identityId)).toBe(10000n);
  });

  it("stops asking the provider once the grace window is over", async () => {
    const db = await createTestDb();
    let calls = 0;
    const pix = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "http://pix.test",
      fetch: async () => {
        calls += 1;
        return json({ success: true, data: { id: "pix_old", status: "PAID", expiresAt: null } });
      },
    });
    const app = createApp(config, policySchema.parse(basePolicy()), { db, pix });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const first = await app.request("/v1/search", { headers: { "x-api-key": "pix-old" } });
    const identityId = first.headers.get("X-AWall-Identity") ?? "";

    const offer = await createOffer(db, {
      identityId,
      packCredits: 10000,
      priceUsdcAtomic: "5000000",
      priceXlmAtomic: "50000000",
      priceBrlCents: 290,
      multiplier: 1,
      network: "stellar:testnet",
      asset: ASSET,
      xlmAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      payTo: config.payTo,
      rails: ["pix"],
      pixChargeId: "pix_old",
      expiresAt: new Date(Date.now() - PIX_LATE_CONFIRM_MS - 60_000),
    });

    const status = await app.request(`/awall/offers/${offer.id}`);
    expect(status.status).toBe(410);
    expect(calls).toBe(0);
    expect(await getBalance(db, identityId)).toBe(0n);
  });
});

describe("revenue", () => {
  it("keeps USDC and XLM totals apart on the same rail", async () => {
    const db = await createTestDb();
    const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
    const app = createApp(config, policySchema.parse(basePolicy()), { db });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const first = await app.request("/v1/search", { headers: { "x-api-key": "two-assets" } });
    const identityId = first.headers.get("X-AWall-Identity") ?? "";

    const newPaidOffer = async (asset: string, amount: string, key: string) => {
      const offer = await createOffer(db, {
        identityId,
        packCredits: 10,
        priceUsdcAtomic: "5000000",
        priceXlmAtomic: "50000000",
        priceBrlCents: 290,
        multiplier: 1,
        network: "stellar:testnet",
        asset: ASSET,
        xlmAsset: XLM,
        payTo: config.payTo,
        rails: ["exact"],
      });
      await grantCredits(db, {
        identityId,
        offerId: offer.id,
        credits: 10,
        payment: {
          rail: "exact",
          amount,
          asset,
          network: "stellar:testnet",
          idempotencyKey: key,
        },
      });
    };
    await newPaidOffer(ASSET, "5000000", "usdc-1");
    await newPaidOffer(XLM, "50000000", "xlm-1");

    const summary = await app.request("/awall/stats/summary?window=1h", {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(summary.status).toBe(200);
    const body = (await summary.json()) as {
      revenue: { rail: string; code: string; amount: string }[];
    };
    const byCode = Object.fromEntries(body.revenue.map((row) => [row.code, row.amount]));
    expect(byCode).toMatchObject({ USDC: "5000000", XLM: "50000000" });
    expect(body.revenue.every((row) => row.rail === "exact")).toBe(true);
  });
});

describe("control plane", () => {
  it("requires the admin token and applies a policy without a restart", async () => {
    const db = await createTestDb();
    let clock = 1_000_000_000_000;
    const app = createApp(config, policySchema.parse(basePolicy()), {
      db,
      now: () => (clock += 5_000),
    });
    expect((await app.request("/awall/stats/summary")).status).toBe(401);
    const summary = await app.request("/awall/stats/summary?window=1h", {
      headers: { authorization: "Bearer admin-secret" },
    });
    expect(summary.status).toBe(200);

    const next = basePolicy();
    next.routes = [{ match: "GET /v1/search", credits: 9 }];
    const put = await app.request("/awall/policy", {
      method: "PUT",
      headers: {
        authorization: "Bearer admin-secret",
        "content-type": "application/json",
        "x-awall-actor": "ada",
      },
      body: JSON.stringify(next),
    });
    expect(put.status).toBe(200);

    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const priced = await app.request("/v1/search", { headers: { "x-api-key": "after-policy" } });
    expect(priced.headers.get("X-AWall-Cost-Credits")).toBe("9");
  });
});

describe("decision mode", () => {
  it("returns 204 or the same 402, and refuses to settle inside forward auth", async () => {
    const db = await createTestDb();
    const app = createApp(config, policySchema.parse(basePolicy()), { db });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const ok = await app.request("/awall/decide", {
      headers: {
        "x-forwarded-method": "GET",
        "x-forwarded-uri": "/v1/search",
        "x-api-key": "edge",
      },
    });
    expect(ok.status).toBe(204);
    expect(ok.headers.get("X-AWall-Reservation")).toBeTruthy();

    const bypass = await app.request("/awall/decide", {
      headers: { "x-forwarded-method": "GET", "x-forwarded-uri": "/v1/search", "payment-signature": "e30=" },
    });
    expect(bypass.status).toBe(400);

    await app.request("/awall/decide", {
      headers: { "x-forwarded-method": "GET", "x-forwarded-uri": "/v1/search", "x-api-key": "edge" },
    });
    const denied = await app.request("/awall/decide", {
      headers: { "x-forwarded-method": "GET", "x-forwarded-uri": "/v1/search", "x-api-key": "edge" },
    });
    expect(denied.status).toBe(402);
    expect(denied.headers.get("PAYMENT-REQUIRED")).toBeTruthy();
  });
});

describe("metered routes", () => {
  it("charges the reported tokens and records the adjustment", async () => {
    const db = await createTestDb();
    const metered = policySchema.parse({
      ...basePolicy(),
      free_tier: { window_seconds: 60, credits: 1, burst: 0 },
      routes: [{ match: "POST /v1/completions", credits: 50, metered: true }],
    });
    const app = createApp(config, metered, { db });
    const seen = await app.request("/v1/completions", {
      method: "POST",
      headers: { "x-api-key": "meter", "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    const id = seen.headers.get("X-AWall-Identity") ?? "";
    const offer = await createOffer(db, {
      identityId: id,
      packCredits: 1000,
      priceUsdcAtomic: "5000000",
      priceXlmAtomic: "50000000",
      priceBrlCents: 290,
      multiplier: 1,
      network: "stellar:testnet",
      asset: ASSET,
      xlmAsset: "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC",
      payTo: config.payTo,
      rails: ["exact"],
    });
    await grantCredits(db, {
      identityId: id,
      offerId: offer.id,
      credits: 1000,
      payment: {
        rail: "exact",
        amount: "5000000",
        asset: ASSET,
        network: "stellar:testnet",
        idempotencyKey: "seed-meter",
      },
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ usage: { outputTokens: 17 } }), { status: 200 })),
    );
    const small = await app.request("/v1/completions", {
      method: "POST",
      headers: { "x-api-key": "meter", "content-type": "application/json" },
      body: JSON.stringify({ prompt: "oi" }),
    });
    expect(small.status).toBe(200);
    expect(small.headers.get("X-AWall-Cost-Credits")).toBe("17");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ usage: { outputTokens: 120 } }), { status: 200 })),
    );
    const large = await app.request("/v1/completions", {
      method: "POST",
      headers: { "x-api-key": "meter", "content-type": "application/json" },
      body: JSON.stringify({ prompt: "x".repeat(300) }),
    });
    expect(large.headers.get("X-AWall-Cost-Credits")).toBe("120");
    expect(large.headers.get("X-AWall-Credits-Remaining")).toBe(String(1000 - 17 - 120));

    const entries = await listLedgerEntries(db, id);
    const reasons = entries.map((entry) => entry.reason);
    expect(reasons).toContain("debit");
    expect(reasons).toContain("refund");
  });
});

describe("abuse price", () => {
  it("charges two identities different prices for the same pack", async () => {
    const db = await createTestDb();
    const wide = policySchema.parse({
      ...basePolicy(),
      free_tier: { window_seconds: 3600, credits: 30, burst: 0 },
      routes: [{ match: "GET /v1/search", credits: 1 }],
    });
    const clock = { t: 1_000_000 };
    const timed = createApp(config, wide, { db, now: () => clock.t });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: RequestInit) => {
        const status = new Headers(init?.headers).get("x-api-key") === "abusive" ? 404 : 200;
        return new Response("{}", { status });
      }),
    );

    const polite = await runPattern(timed, "polite", true, clock);
    const abusive = await runPattern(timed, "abusive", false, clock);
    expect(Number(abusive)).toBeGreaterThan(Number(polite));
    expect(Number(abusive)).toBeLessThanOrEqual(3);
  });
});

describe("retention", () => {
  it("drops raw events and keeps the hourly numbers", async () => {
    const db = await createTestDb();
    const app = createApp(config, policySchema.parse(basePolicy()), { db });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const seen = await app.request("/v1/search", { headers: { "x-api-key": "keep" } });
    const id = seen.headers.get("X-AWall-Identity") ?? "";
    await recordUsageEvent(db, {
      identityId: id,
      method: "GET",
      route: "GET /v1/search",
      credits: 2,
      decision: "allow_free",
      requestHash: "old",
      createdAt: new Date(Date.now() - 10 * 86_400_000),
    });
    const removed = await purgeUsageEvents(db, new Date(Date.now() - 7 * 86_400_000));
    expect(removed).toBe(1);
    const rollups = await listUsageRollups(db, { identityId: id });
    expect(rollups.reduce((sum, row) => sum + row.requests, 0)).toBeGreaterThan(0);
  });
});

async function runPattern(
  app: ReturnType<typeof createApp>,
  key: string,
  polite: boolean,
  clock: { t: number },
): Promise<string> {
  let multiplier = "1.00";
  for (let i = 0; i < 31; i += 1) {
    clock.t += polite ? 800 : 10;
    const res = await app.request(`/v1/search?n=${polite ? i : 1}`, {
      headers: {
        "x-api-key": key,
        ...(polite ? {} : { "cache-control": "no-cache" }),
      },
    });
    multiplier = res.headers.get("X-AWall-Price-Multiplier") ?? multiplier;
  }
  return multiplier;
}

function basePolicy() {
  return {
    origin: "http://127.0.0.1:59999",
    free_tier: { window_seconds: 60, credits: 4, burst: 0 },
    pricing: { pack_credits: 10000, price_usdc: "0.50", price_xlm: "5.00", price_brl_cents: 290, max_multiplier: 3 },
    routes: [{ match: "GET /v1/search", credits: 2 }],
  };
}

function signature(offerId: string, amount: string, asset = ASSET): string {
  const payload = {
    x402Version: 2,
    accepted: {
      scheme: "exact",
      network: "stellar:testnet",
      amount,
      asset,
      payTo: config.payTo,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true, packCredits: 10000, offerId },
    },
    payload: { transaction: "signed" },
  };
  return encodeHeader(payload);
}

async function exhaust(
  app: ReturnType<typeof createApp>,
  key = "payer",
): Promise<{
  offerId: string;
  identityId: string;
  amount: string;
  accepts: { amount: string; asset: string; extra: { offerId: string } }[];
}> {
  const headers = { "x-api-key": key };
  for (let i = 0; i < 2; i += 1) await app.request("/v1/search", { headers });
  const res = await app.request("/v1/search", { headers });
  const decoded = decodeHeader(res.headers.get("PAYMENT-REQUIRED") ?? "");
  if (!decoded.ok) throw new Error("no payment required");
  const accepts = decoded.value["accepts"] as {
    amount: string;
    asset: string;
    extra: { offerId: string };
  }[];
  return {
    offerId: accepts[0]?.extra.offerId ?? "",
    identityId: res.headers.get("X-AWall-Identity") ?? "",
    amount: accepts[0]?.amount ?? "",
    accepts,
  };
}

async function exhaustToHeader(app: ReturnType<typeof createApp>, key: string): Promise<string> {
  const headers = { "x-api-key": key };
  for (let i = 0; i < 2; i += 1) await app.request("/v1/search", { headers });
  const res = await app.request("/v1/search", { headers });
  return res.headers.get("PAYMENT-REQUIRED") ?? "";
}

async function pay(app: ReturnType<typeof createApp>, offerId: string, amount: string): Promise<Response> {
  return app.request("/v1/search", {
    headers: { "x-api-key": "payer", "payment-signature": signature(offerId, amount) },
  });
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
}
