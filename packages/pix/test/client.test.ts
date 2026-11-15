import { describe, expect, it } from "vitest";
import { AbacatePayClient } from "../src/client.js";
import { jsonResponse, stubFetch, unwrap, unwrapErr } from "./helpers.js";

const BASE_URL = "https://provider.test/v2";
const API_KEY = "abc_test_key";

const createdCharge = {
  data: {
    id: "pix_char_z2rSk6042t1mCKgGgeBpJe1u",
    amount: 394,
    status: "PENDING",
    devMode: true,
    brCode: "00020101021226950014br.gov.bcb.pix...",
    brCodeBase64: "data:image/png;base64,iVBORw0KGgo...",
    platformFee: 80,
    receiptUrl: null,
    expiresAt: "2026-11-28T18:42:00.000Z",
  },
  success: true,
  error: null,
};

describe("createPixCharge", () => {
  it("posts amount in centavos and reads the documented response fields", async () => {
    const stub = stubFetch([jsonResponse(createdCharge)]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const charge = unwrap(
      await client.createPixCharge({
        amountCents: 394n,
        expiresInSeconds: 900,
        description: "AWall credits pack",
      }),
    );

    expect(charge).toEqual({
      chargeId: "pix_char_z2rSk6042t1mCKgGgeBpJe1u",
      amountCents: 394n,
      status: "PENDING",
      brCode: "00020101021226950014br.gov.bcb.pix...",
      brCodeBase64: "data:image/png;base64,iVBORw0KGgo...",
      expiresAt: "2026-11-28T18:42:00.000Z",
      devMode: true,
    });

    const call = stub.calls[0];
    expect(call?.url).toBe(`${BASE_URL}/transparents/create`);
    expect(call?.init?.method).toBe("POST");
    expect(JSON.parse(String(call?.init?.body))).toEqual({
      method: "PIX",
      data: { amount: 394, expiresIn: 900, description: "AWall credits pack" },
    });
  });

  it("sends the API key as a bearer token and nowhere else", async () => {
    const stub = stubFetch([jsonResponse(createdCharge)]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });
    await client.createPixCharge({ amountCents: 394n, expiresInSeconds: 900 });

    const call = stub.calls[0];
    const headers = call?.init?.headers as Record<string, string>;
    expect(headers["authorization"]).toBe(`Bearer ${API_KEY}`);
    expect(call?.url).not.toContain(API_KEY);
    expect(String(call?.init?.body)).not.toContain(API_KEY);
  });

  it("rejects amounts below the provider minimum without a request", async () => {
    const stub = stubFetch([]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const error = unwrapErr(await client.createPixCharge({ amountCents: 99n, expiresInSeconds: 900 }));
    expect(error.kind).toBe("invalid_request");
    expect(stub.calls).toHaveLength(0);
  });

  it("rejects an expiry below 300 seconds without a request", async () => {
    const stub = stubFetch([]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const error = unwrapErr(await client.createPixCharge({ amountCents: 394n, expiresInSeconds: 60 }));
    expect(error.kind).toBe("invalid_request");
    expect(stub.calls).toHaveLength(0);
  });

  it("never leaks the API key into an error message", async () => {
    const stub = stubFetch([
      jsonResponse({ data: null, success: false, error: `invalid key ${API_KEY}` }, 401),
    ]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const error = unwrapErr(await client.createPixCharge({ amountCents: 394n, expiresInSeconds: 900 }));
    expect(error.kind).toBe("http_error");
    expect(error.status).toBe(401);
    expect(error.message).not.toContain(API_KEY);
    expect(error.message).toContain("[redacted]");
  });

  it("maps an aborted request to a timeout error", async () => {
    const stub = stubFetch([
      () => {
        throw new DOMException("the operation was aborted", "TimeoutError");
      },
    ]);
    const client = new AbacatePayClient({
      apiKey: API_KEY,
      baseUrl: BASE_URL,
      fetch: stub.fetch,
      timeoutMs: 25,
    });

    const error = unwrapErr(await client.createPixCharge({ amountCents: 394n, expiresInSeconds: 900 }));
    expect(error.kind).toBe("timeout");
  });
});

describe("getChargeStatus", () => {
  it("reads status and expiry from the check endpoint", async () => {
    const stub = stubFetch([
      jsonResponse({
        data: {
          id: "pix_char_z2rSk6042t1mCKgGgeBpJe1u",
          status: "PAID",
          expiresAt: "2026-11-28T18:42:00.000Z",
        },
        error: null,
        success: true,
      }),
    ]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const status = unwrap(await client.getChargeStatus("pix_char_z2rSk6042t1mCKgGgeBpJe1u"));
    expect(status).toEqual({
      chargeId: "pix_char_z2rSk6042t1mCKgGgeBpJe1u",
      status: "PAID",
      expiresAt: "2026-11-28T18:42:00.000Z",
    });
    expect(stub.calls[0]?.url).toBe(
      `${BASE_URL}/transparents/check?id=pix_char_z2rSk6042t1mCKgGgeBpJe1u`,
    );
  });

  it("reports an expired charge as the provider does", async () => {
    const stub = stubFetch([
      jsonResponse({
        data: { id: "pix_char_old", status: "EXPIRED", expiresAt: "2026-11-01T00:00:00.000Z" },
        error: null,
        success: true,
      }),
    ]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const status = unwrap(await client.getChargeStatus("pix_char_old"));
    expect(status.status).toBe("EXPIRED");
  });

  it("rejects an unknown status value instead of guessing", async () => {
    const stub = stubFetch([
      jsonResponse({ data: { id: "pix_char_x", status: "SETTLED" }, error: null, success: true }),
    ]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const error = unwrapErr(await client.getChargeStatus("pix_char_x"));
    expect(error.kind).toBe("invalid_response");
  });

  it("treats a provider error envelope as a failure even on HTTP 200", async () => {
    const stub = stubFetch([
      jsonResponse({ data: null, success: false, error: "Pix QR Code not found" }),
    ]);
    const client = new AbacatePayClient({ apiKey: API_KEY, baseUrl: BASE_URL, fetch: stub.fetch });

    const error = unwrapErr(await client.getChargeStatus("pix_char_missing"));
    expect(error.kind).toBe("provider_error");
    expect(error.message).toBe("Pix QR Code not found");
  });
});
