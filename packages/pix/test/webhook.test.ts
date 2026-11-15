import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { AbacatePayClient } from "../src/client.js";
import { confirmPaid } from "../src/confirm.js";
import { verifyWebhook } from "../src/webhook.js";
import { jsonResponse, stubFetch, unwrap, unwrapErr } from "./helpers.js";

const SECRET = "d6f0ad9c2bb64e3a9f1c7c2a6b0e4d118f5a3c7e9b2d4f6a8c0e2b4d6f8a0c2e";
const SIGNATURE_KEY = "abacatepay-public-body-signing-key";
const CHARGE_ID = "pix_char_mXq2Lk7vB9nR4sT8yW1zC6dF";

const body = JSON.stringify({
  id: "log_Qw8eR2tY4uI6oP1aS3dF5gH7",
  event: "transparent.completed",
  apiVersion: 2,
  devMode: true,
  data: {
    transparent: { id: CHARGE_ID, amount: 394, status: "PAID" },
    payerInformation: { method: "PIX" },
  },
});

function sign(raw: string, key = SIGNATURE_KEY): string {
  return createHmac("sha256", key).update(Buffer.from(raw, "utf8")).digest("base64");
}

describe("verifyWebhook", () => {
  it("accepts the secret from the X-Webhook-Secret header", () => {
    const verified = unwrap(verifyWebhook(body, { "X-Webhook-Secret": SECRET }, SECRET));
    expect(verified.envelope.event).toBe("transparent.completed");
    expect(verified.chargeId).toBe(CHARGE_ID);
    expect(verified.signatureChecked).toBe(false);
  });

  it("accepts the secret from the webhookSecret query parameter", () => {
    const url = new URL(`https://awall.demo/webhooks/abacatepay?webhookSecret=${SECRET}`);
    expect(unwrap(verifyWebhook(body, url, SECRET)).chargeId).toBe(CHARGE_ID);
  });

  it("rejects a delivery whose secret does not match", () => {
    const error = unwrapErr(verifyWebhook(body, { "x-webhook-secret": `${SECRET}x` }, SECRET));
    expect(error.kind).toBe("secret_mismatch");
  });

  it("rejects a delivery that carries no secret at all", () => {
    const error = unwrapErr(verifyWebhook(body, {}, SECRET));
    expect(error.kind).toBe("missing_secret");
  });

  it("refuses to run without a configured secret", () => {
    const error = unwrapErr(verifyWebhook(body, { "x-webhook-secret": SECRET }, ""));
    expect(error.kind).toBe("missing_secret");
  });

  it("checks the body signature when the signing key is supplied", () => {
    const headers = new Headers({
      "x-webhook-secret": SECRET,
      "x-webhook-signature": sign(body),
    });
    const verified = unwrap(verifyWebhook(body, headers, SECRET, { signatureKey: SIGNATURE_KEY }));
    expect(verified.signatureChecked).toBe(true);
  });

  it("rejects an invalid signature", () => {
    const headers = new Headers({
      "x-webhook-secret": SECRET,
      "x-webhook-signature": sign(body, "wrong-key"),
    });
    const error = unwrapErr(verifyWebhook(body, headers, SECRET, { signatureKey: SIGNATURE_KEY }));
    expect(error.kind).toBe("invalid_signature");
  });

  it("rejects a signature computed over a different body", () => {
    const tampered = body.replace("394", "1");
    const headers = new Headers({
      "x-webhook-secret": SECRET,
      "x-webhook-signature": sign(body),
    });
    const error = unwrapErr(verifyWebhook(tampered, headers, SECRET, { signatureKey: SIGNATURE_KEY }));
    expect(error.kind).toBe("invalid_signature");
  });

  it("can demand a signature and reject a delivery without one", () => {
    const error = unwrapErr(
      verifyWebhook(body, { "x-webhook-secret": SECRET }, SECRET, {
        signatureKey: SIGNATURE_KEY,
        requireSignature: true,
      }),
    );
    expect(error.kind).toBe("missing_signature");
  });

  it("verifies the raw bytes, not a re-serialised body", () => {
    const raw = Buffer.from(` ${body} `, "utf8");
    const headers = new Headers({
      "x-webhook-secret": SECRET,
      "x-webhook-signature": createHmac("sha256", SIGNATURE_KEY).update(raw).digest("base64"),
    });
    expect(unwrap(verifyWebhook(raw, headers, SECRET, { signatureKey: SIGNATURE_KEY })).chargeId).toBe(
      CHARGE_ID,
    );
  });

  it("rejects a body that is not the documented envelope", () => {
    const error = unwrapErr(verifyWebhook("not json", { "x-webhook-secret": SECRET }, SECRET));
    expect(error.kind).toBe("invalid_body");
  });
});

describe("confirmPaid", () => {
  it("does not believe a PAID webhook body: it asks the provider", async () => {
    // Body says PAID; the provider says PENDING. The provider wins.
    const verified = unwrap(verifyWebhook(body, { "x-webhook-secret": SECRET }, SECRET));
    const stub = stubFetch([
      jsonResponse({ data: { id: CHARGE_ID, status: "PENDING" }, error: null, success: true }),
    ]);
    const client = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "https://provider.test/v2",
      fetch: stub.fetch,
    });

    const confirmation = unwrap(await confirmPaid(client, verified.chargeId ?? ""));
    expect(confirmation.paid).toBe(false);
    expect(confirmation.status).toBe("PENDING");
  });

  it("reports paid only on an explicit PAID status", async () => {
    const stub = stubFetch([
      jsonResponse({ data: { id: CHARGE_ID, status: "PAID" }, error: null, success: true }),
      jsonResponse({ data: { id: CHARGE_ID, status: "APPROVED" }, error: null, success: true }),
    ]);
    const client = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "https://provider.test/v2",
      fetch: stub.fetch,
    });

    expect(unwrap(await confirmPaid(client, CHARGE_ID)).paid).toBe(true);
    expect(unwrap(await confirmPaid(client, CHARGE_ID)).paid).toBe(false);
  });

  it("surfaces a provider failure instead of assuming unpaid", async () => {
    const stub = stubFetch([jsonResponse({ data: null, success: false, error: "boom" }, 500)]);
    const client = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "https://provider.test/v2",
      fetch: stub.fetch,
    });

    const error = unwrapErr(await confirmPaid(client, CHARGE_ID));
    expect(error.kind).toBe("http_error");
    expect(error.status).toBe(500);
  });
});
