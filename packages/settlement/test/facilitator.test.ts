import { describe, expect, it } from "vitest";
import { FacilitatorClient } from "../src/facilitator.js";
import { PAYER, stellarPayload, stellarRequirements } from "./fixtures.js";

const BASE_URL = "https://facilitator.test";

/** One recorded call made through the stubbed fetch. */
type RecordedCall = { url: string; method: string; body: unknown };

/**
 * Build a client whose fetch answers with a fixed JSON body.
 *
 * @param status - HTTP status to answer with.
 * @param body - Response body, serialized as JSON when not a string.
 * @returns The client plus the list of calls it made.
 */
function clientReturning(
  status: number,
  body: unknown,
): { client: FacilitatorClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const text = typeof body === "string" ? body : JSON.stringify(body);
  const fetchStub: typeof globalThis.fetch = async (input, init) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    return new Response(text, { status, headers: { "Content-Type": "application/json" } });
  };
  return { client: new FacilitatorClient({ baseUrl: BASE_URL, fetch: fetchStub }), calls };
}

describe("supported", () => {
  it("reads the kinds the facilitator advertises", async () => {
    const { client, calls } = clientReturning(200, {
      kinds: [
        { x402Version: 2, scheme: "exact", network: "stellar:testnet", extra: { areFeesSponsored: true } },
        { x402Version: 2, scheme: "exact", network: "eip155:8453" },
      ],
      extensions: ["bazaar"],
      signers: { "stellar:*": ["GDFACILITATOR"] },
    });

    const result = await client.supported();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.kinds).toHaveLength(2);
    expect(result.ok && result.value.kinds[0]?.extra).toEqual({ areFeesSponsored: true });
    expect(result.ok && result.value.extensions).toEqual(["bazaar"]);
    expect(calls[0]).toMatchObject({ url: `${BASE_URL}/supported`, method: "GET" });
  });

  it("tolerates a response without extensions or signers", async () => {
    const { client } = clientReturning(200, {
      kinds: [{ x402Version: 2, scheme: "exact", network: "stellar:testnet" }],
    });

    const result = await client.supported();

    expect(result.ok && result.value.extensions).toEqual([]);
    expect(result.ok && result.value.signers).toEqual({});
  });

  it("drops v1 kinds whose network is not CAIP-2", async () => {
    const { client } = clientReturning(200, {
      kinds: [
        { x402Version: 2, scheme: "exact", network: "stellar:testnet" },
        { x402Version: 1, scheme: "exact", network: "base-sepolia" },
        { scheme: "exact" },
        "not an object",
      ],
      extensions: [],
      signers: {},
    });

    const result = await client.supported();

    expect(result.ok).toBe(true);
    expect(result.ok && result.value.kinds).toEqual([
      { x402Version: 2, scheme: "exact", network: "stellar:testnet" },
    ]);
  });

  it("reports a body with no kinds array as malformed", async () => {
    const { client } = clientReturning(200, { schemes: ["exact"] });

    const result = await client.supported();

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toEqual({
      kind: "malformed_body",
      message: "/supported body has no kinds array",
    });
  });

  it("strips a trailing slash from the base URL", async () => {
    const calls: RecordedCall[] = [];
    const fetchStub: typeof globalThis.fetch = async (input) => {
      calls.push({ url: String(input), method: "GET", body: undefined });
      return new Response(JSON.stringify({ kinds: [] }), { status: 200 });
    };
    const client = new FacilitatorClient({ baseUrl: `${BASE_URL}/`, fetch: fetchStub });

    await client.supported();

    expect(calls[0]?.url).toBe(`${BASE_URL}/supported`);
  });
});

describe("verify", () => {
  it("returns valid and forwards payload plus requirements", async () => {
    const { client, calls } = clientReturning(200, { isValid: true, payer: PAYER });
    const requirements = stellarRequirements();

    const result = await client.verify(stellarPayload(), requirements);

    expect(result.ok && result.value.status).toBe("valid");
    expect(result.ok && result.value.payer).toBe(PAYER);
    expect(calls[0]?.url).toBe(`${BASE_URL}/verify`);
    expect(calls[0]?.body).toMatchObject({
      x402Version: 2,
      paymentRequirements: { amount: "6800000", network: "stellar:testnet" },
    });
  });

  it("returns the invalidReason on a terminal rejection", async () => {
    const { client } = clientReturning(200, {
      isValid: false,
      invalidReason: "invalid_exact_stellar_payload_wrong_amount",
      invalidMessage: "transfer amount does not match requirements",
      payer: PAYER,
    });

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("invalid");
    expect(result.ok && result.value.status === "invalid" && result.value.invalidReason).toBe(
      "invalid_exact_stellar_payload_wrong_amount",
    );
    expect(result.ok && result.value.response.invalidMessage).toBe(
      "transfer amount does not match requirements",
    );
  });

  it("reads an invalid verdict served with a 4xx status", async () => {
    const { client } = clientReturning(400, { isValid: false, invalidReason: "invalid_payload" });

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("invalid");
  });

  it("falls back to unexpected_verify_error when the reason is missing", async () => {
    const { client } = clientReturning(200, { isValid: false });

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status === "invalid" && result.value.invalidReason).toBe(
      "unexpected_verify_error",
    );
  });

  it("reports a body without isValid as malformed", async () => {
    const { client } = clientReturning(200, { valid: true });

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(!result.ok && result.failure.kind).toBe("malformed_body");
  });

  it("reports a 500 with an HTML body as an http_status failure", async () => {
    const { client } = clientReturning(502, "<html>bad gateway</html>");

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toEqual({
      kind: "http_status",
      status: 502,
      body: "<html>bad gateway</html>",
    });
  });

  it("reports a 500 with a JSON body as an http_status failure too", async () => {
    const { client } = clientReturning(500, { error: "internal" });

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(!result.ok && result.failure.kind).toBe("http_status");
  });
});

describe("settle", () => {
  it("returns settled with the transaction hash", async () => {
    const hash = "a1b2c3".padEnd(64, "0");
    const { client, calls } = clientReturning(200, {
      success: true,
      transaction: hash,
      network: "stellar:testnet",
      payer: PAYER,
    });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("settled");
    expect(result.ok && result.value.transaction).toBe(hash);
    expect(result.ok && result.value.network).toBe("stellar:testnet");
    expect(calls[0]?.url).toBe(`${BASE_URL}/settle`);
  });

  it("keeps the settled amount when the scheme reports one", async () => {
    const { client } = clientReturning(200, {
      success: true,
      transaction: "f".repeat(64),
      network: "stellar:testnet",
      amount: "6800000",
    });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status === "settled" && result.value.amount).toBe("6800000");
  });

  it("returns failed on a terminal error", async () => {
    const { client } = clientReturning(200, {
      success: false,
      errorReason: "insufficient_funds",
      transaction: "",
      network: "stellar:testnet",
      payer: PAYER,
    });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("failed");
    expect(result.ok && result.value.status === "failed" && result.value.errorReason).toBe(
      "insufficient_funds",
    );
  });

  it("returns failed for a Stellar submission error", async () => {
    const { client } = clientReturning(200, {
      success: false,
      errorReason: "settle_exact_stellar_transaction_failed",
      transaction: "",
      network: "stellar:testnet",
    });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("failed");
  });

  it("returns pending, not failed, for settlement_pending", async () => {
    const hash = "9".repeat(64);
    const { client } = clientReturning(200, {
      success: false,
      errorReason: "settlement_pending",
      transaction: hash,
      network: "stellar:testnet",
      payer: PAYER,
    });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("pending");
    expect(result.ok && result.value.status === "pending" && result.value.reconcilable).toBe(true);
    expect(result.ok && result.value.transaction).toBe(hash);
  });

  it("marks settlement_pending without a hash as unreconcilable", async () => {
    const { client } = clientReturning(200, {
      success: false,
      errorReason: "settlement_pending",
      transaction: "",
      network: "stellar:testnet",
    });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok && result.value.status).toBe("pending");
    expect(result.ok && result.value.status === "pending" && result.value.reconcilable).toBe(false);
  });

  it("reports a body without a network as malformed", async () => {
    const { client } = clientReturning(200, { success: true, transaction: "abc" });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(!result.ok && result.failure).toEqual({
      kind: "malformed_body",
      message: "/settle body has no CAIP-2 network",
    });
  });
});

describe("transport failures", () => {
  it("returns a timeout failure when the request outlives timeoutMs", async () => {
    const fetchStub: typeof globalThis.fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("The operation was aborted")));
      });
    const client = new FacilitatorClient({ baseUrl: BASE_URL, fetch: fetchStub, timeoutMs: 10 });

    const result = await client.settle(stellarPayload(), stellarRequirements());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.failure).toEqual({ kind: "timeout", timeoutMs: 10 });
  });

  it("returns a network failure when fetch rejects", async () => {
    const fetchStub: typeof globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    const client = new FacilitatorClient({ baseUrl: BASE_URL, fetch: fetchStub });

    const result = await client.verify(stellarPayload(), stellarRequirements());

    expect(!result.ok && result.failure).toEqual({ kind: "network", message: "fetch failed" });
  });

  it("sends the configured extra headers", async () => {
    let seen: Record<string, string> = {};
    const fetchStub: typeof globalThis.fetch = async (_input, init) => {
      seen = Object.fromEntries(new Headers(init?.headers).entries());
      return new Response(JSON.stringify({ kinds: [] }), { status: 200 });
    };
    const client = new FacilitatorClient({
      baseUrl: BASE_URL,
      fetch: fetchStub,
      headers: { Authorization: "Bearer test-token" },
    });

    await client.supported();

    expect(seen["authorization"]).toBe("Bearer test-token");
    expect(seen["accept"]).toBe("application/json");
  });
});
