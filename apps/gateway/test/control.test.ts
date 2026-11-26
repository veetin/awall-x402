import { describe, expect, it } from "vitest";
import { createOffer, ensureIdentity, grantCredits } from "@awall/ledger";
import { policySchema } from "@awall/policy";
import { createApp } from "../src/app.js";
import { readConfig } from "../src/config.js";
import { createTestDb, createTestDbHandle } from "./db.js";

const config = readConfig({
  AWALL_PORT: "8402",
  STELLAR_PAY_TO: "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO",
  AWALL_ADMIN_TOKEN: "admin-secret",
  AWALL_CONSOLE_ORIGIN: "http://localhost:4179",
} as NodeJS.ProcessEnv);

const ASSET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
const XLM = "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";
const ADMIN = { authorization: "Bearer admin-secret" } as const;

const policy = policySchema.parse({
  origin: "http://127.0.0.1:59999",
  free_tier: { window_seconds: 60, credits: 4, burst: 0 },
  pricing: {
    pack_credits: 10000,
    price_usdc: "0.50",
    price_xlm: "5.00",
    price_brl_cents: 290,
    max_multiplier: 3,
  },
  routes: [{ match: "GET /v1/search", credits: 2 }],
});

/** A streaming response holds the process open until the body is dropped. */
async function closeStream(response: Response): Promise<void> {
  await response.body?.cancel();
}

async function mintTicket(app: ReturnType<typeof createApp>): Promise<string> {
  const minted = await app.request("/awall/stats/stream-ticket", {
    method: "POST",
    headers: ADMIN,
  });
  expect(minted.status).toBe(200);
  const body = (await minted.json()) as { ticket: string; expiresInMs: number };
  expect(body.expiresInMs).toBeGreaterThan(0);
  return body.ticket;
}

describe("stream authentication", () => {
  it("refuses the admin token in the query string and takes a minted ticket", async () => {
    const app = createApp(config, policy, { db: await createTestDb() });

    // The old URL shape. A query string lands in access logs and in history,
    // so the admin token is not a credential there any more.
    const viaQuery = await app.request("/awall/stats/stream?access_token=admin-secret");
    expect(viaQuery.status).toBe(401);
    await closeStream(viaQuery);
    const noCredential = await app.request("/awall/stats/stream");
    expect(noCredential.status).toBe(401);
    await closeStream(noCredential);

    const ticket = await mintTicket(app);
    expect(ticket).not.toBe("admin-secret");
    const streamed = await app.request(`/awall/stats/stream?ticket=${encodeURIComponent(ticket)}`);
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("content-type")).toContain("text/event-stream");
    await closeStream(streamed);
  });

  it("burns a ticket after one use and rejects one it never minted", async () => {
    const app = createApp(config, policy, { db: await createTestDb() });
    const ticket = await mintTicket(app);

    const first = await app.request(`/awall/stats/stream?ticket=${encodeURIComponent(ticket)}`);
    expect(first.status).toBe(200);
    await closeStream(first);

    const replay = await app.request(`/awall/stats/stream?ticket=${encodeURIComponent(ticket)}`);
    expect(replay.status).toBe(401);
    await closeStream(replay);

    const forged = await app.request("/awall/stats/stream?ticket=not-a-ticket");
    expect(forged.status).toBe(401);
    await closeStream(forged);
  });

  it("keeps the Authorization header working, and mints no ticket without it", async () => {
    const app = createApp(config, policy, { db: await createTestDb() });

    const anonymous = await app.request("/awall/stats/stream-ticket", { method: "POST" });
    expect(anonymous.status).toBe(401);

    // Non-browser clients never need a ticket: they can send the header.
    const streamed = await app.request("/awall/stats/stream", { headers: ADMIN });
    expect(streamed.status).toBe(200);
    expect(streamed.headers.get("content-type")).toContain("text/event-stream");
    await closeStream(streamed);
  });
});

describe("health checks", () => {
  it("reports the database it actually queried and times a real decision", async () => {
    const handle = await createTestDbHandle();
    const app = createApp(config, policy, { db: handle.db });

    const healthy = await app.request("/awall/health/checks", { headers: ADMIN });
    expect(healthy.status).toBe(200);
    const ok = (await healthy.json()) as {
      database: { status: string; latencyMs: number; code?: string };
      decisionMs: number;
      decision: { probe: string; kind: string };
    };
    expect(ok.database.status).toBe("ok");
    expect(ok.database.latencyMs).toBeGreaterThanOrEqual(0);
    // The timing names a decision, so it has to be a decision that was made.
    expect(ok.decision).toEqual({ probe: "GET /v1/search", kind: "charge" });
    expect(ok.decisionMs).toBeGreaterThanOrEqual(0);

    // Take the database away. A report of "ok" here would be invented.
    await handle.close();
    const broken = await app.request("/awall/health/checks", { headers: ADMIN });
    expect(broken.status).toBe(200);
    const failed = (await broken.json()) as {
      database: { status: string; code?: string };
    };
    expect(failed.database.status).toBe("error");
    expect(failed.database.status).not.toBe("ok");
    expect(typeof failed.database.code).toBe("string");
  });
});

describe("identity paging", () => {
  it("serves a bounded page and says that more rows exist", async () => {
    const db = await createTestDb();
    const app = createApp(config, policy, { db });
    const ids = ["idt_page_a", "idt_page_b", "idt_page_c"];
    for (const id of ids) await ensureIdentity(db, { id, kind: "api_key" });

    const firstResponse = await app.request("/awall/identities?limit=2", { headers: ADMIN });
    expect(firstResponse.status).toBe(200);
    const first = (await firstResponse.json()) as {
      identities: { id: string }[];
      page: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null };
    };
    expect(first.identities).toHaveLength(2);
    expect(first.page).toEqual({ limit: 2, offset: 0, hasMore: true, nextOffset: 2 });

    const lastResponse = await app.request("/awall/identities?limit=2&offset=2", { headers: ADMIN });
    const last = (await lastResponse.json()) as {
      identities: { id: string }[];
      page: { hasMore: boolean; nextOffset: number | null };
    };
    expect(last.identities).toHaveLength(1);
    expect(last.page).toMatchObject({ hasMore: false, nextOffset: null });

    // Both pages together are every row, each row once.
    const seen = [...first.identities, ...last.identities].map((row) => row.id).sort();
    expect(seen).toEqual([...ids].sort());
  });

  it("clamps a limit above the documented maximum", async () => {
    const app = createApp(config, policy, { db: await createTestDb() });
    const response = await app.request("/awall/identities?limit=100000", { headers: ADMIN });
    const body = (await response.json()) as { page: { limit: number } };
    expect(body.page.limit).toBe(200);
  });

  it("pages the ledger history of one identity", async () => {
    const db = await createTestDb();
    const app = createApp(config, policy, { db });
    const identityId = "idt_history";
    await ensureIdentity(db, { id: identityId, kind: "api_key" });
    for (const key of ["grant-1", "grant-2", "grant-3"]) {
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
          amount: "5000000",
          asset: ASSET,
          network: "stellar:testnet",
          idempotencyKey: key,
        },
      });
    }

    const pagedResponse = await app.request(`/awall/identities/${identityId}?limit=2`, {
      headers: ADMIN,
    });
    expect(pagedResponse.status).toBe(200);
    const paged = (await pagedResponse.json()) as {
      ledger: unknown[];
      ledgerPage: { limit: number; offset: number; hasMore: boolean; nextOffset: number | null };
    };
    expect(paged.ledger).toHaveLength(2);
    expect(paged.ledgerPage).toEqual({ limit: 2, offset: 0, hasMore: true, nextOffset: 2 });

    const restResponse = await app.request(`/awall/identities/${identityId}?limit=2&offset=2`, {
      headers: ADMIN,
    });
    const rest = (await restResponse.json()) as {
      ledger: unknown[];
      ledgerPage: { hasMore: boolean; nextOffset: number | null };
    };
    expect(rest.ledger).toHaveLength(1);
    expect(rest.ledgerPage).toMatchObject({ hasMore: false, nextOffset: null });
  });

  it("still answers 404 for an unknown identity", async () => {
    const app = createApp(config, policy, { db: await createTestDb() });
    const response = await app.request("/awall/identities/idt_nope", { headers: ADMIN });
    expect(response.status).toBe(404);
  });
});
