import { describe, expect, it } from "vitest";
import { AbacatePayClient } from "../src/client.js";
import { buildPixRequirements } from "../src/requirements.js";
import type { PixChargeRecord } from "../src/types.js";
import { verifyPixPayment, verifyPixPaymentWithProvider } from "../src/verify.js";
import { jsonResponse, stubFetch, unwrap, unwrapErr } from "./helpers.js";

const NOW = new Date("2026-11-28T18:30:00Z");
const CHARGE_ID = "pix_char_z2rSk6042t1mCKgGgeBpJe1u";

const requirements = buildPixRequirements({
  amountCents: 394n,
  chargeId: CHARGE_ID,
  checkoutUrl: `https://awall.demo/pay/${CHARGE_ID}`,
  statusUrl: `https://api.awall.demo/awall/offers/${CHARGE_ID}`,
  expiresAt: "2026-11-28T18:42:00Z",
});

const record: PixChargeRecord = {
  chargeId: CHARGE_ID,
  amountCents: 394n,
  expiresAt: new Date("2026-11-28T18:42:00Z"),
  consumedAt: null,
};

const payload = { chargeId: CHARGE_ID };

describe("verifyPixPayment", () => {
  it("accepts a paid, unconsumed charge and keys the credit by chargeId", () => {
    const result = unwrap(
      verifyPixPayment({ requirements, payload, record, providerStatus: "PAID", now: NOW }),
    );
    expect(result).toEqual({
      chargeId: CHARGE_ID,
      amountCents: 394n,
      idempotencyKey: `pix:${CHARGE_ID}`,
      endToEndId: null,
    });
  });

  it("carries the end-to-end id through for reconciliation only", () => {
    const result = unwrap(
      verifyPixPayment({
        requirements,
        payload: { chargeId: CHARGE_ID, endToEndId: "E000000002026112818420012345678" },
        record,
        providerStatus: "PAID",
        now: NOW,
      }),
    );
    expect(result.endToEndId).toBe("E000000002026112818420012345678");
  });

  it("rejects an unknown charge", () => {
    const failure = unwrapErr(
      verifyPixPayment({ requirements, payload, record: null, providerStatus: "PAID", now: NOW }),
    );
    expect(failure.code).toBe("invalid_pix_charge_unknown");
  });

  it("rejects a payload that references a charge that was not advertised", () => {
    const failure = unwrapErr(
      verifyPixPayment({
        requirements,
        payload: { chargeId: "pix_char_other" },
        record: { ...record, chargeId: "pix_char_other" },
        providerStatus: "PAID",
        now: NOW,
      }),
    );
    expect(failure.code).toBe("invalid_pix_charge_unknown");
  });

  it("rejects an expired charge even when the provider reports it paid", () => {
    const failure = unwrapErr(
      verifyPixPayment({
        requirements,
        payload,
        record,
        providerStatus: "PAID",
        now: new Date("2026-11-28T18:42:00Z"),
      }),
    );
    expect(failure.code).toBe("invalid_pix_charge_expired");
  });

  it("rejects a charge that already granted access", () => {
    const failure = unwrapErr(
      verifyPixPayment({
        requirements,
        payload,
        record: { ...record, consumedAt: new Date("2026-11-28T18:35:00Z") },
        providerStatus: "PAID",
        now: NOW,
      }),
    );
    expect(failure.code).toBe("invalid_pix_charge_already_consumed");
  });

  it("compares the required amount against our record, never against the client", () => {
    // The client echoes a tampered `accepted` object with a smaller amount; the
    // amount still comes from the record and from the advertised requirements.
    const tampered = { ...requirements, amount: "1" };
    const failure = unwrapErr(
      verifyPixPayment({
        requirements: tampered,
        payload,
        record,
        providerStatus: "PAID",
        now: NOW,
      }),
    );
    expect(failure.code).toBe("invalid_pix_charge_amount_mismatch");
  });

  it("rejects a record whose amount drifted from the advertised amount", () => {
    const failure = unwrapErr(
      verifyPixPayment({
        requirements,
        payload,
        record: { ...record, amountCents: 395n },
        providerStatus: "PAID",
        now: NOW,
      }),
    );
    expect(failure.code).toBe("invalid_pix_charge_amount_mismatch");
  });

  it("rejects a charge that is not paid yet, as a non-terminal condition", () => {
    const failure = unwrapErr(
      verifyPixPayment({ requirements, payload, record, providerStatus: "PENDING", now: NOW }),
    );
    expect(failure.code).toBe("invalid_pix_charge_not_paid");
  });

  it("does not treat APPROVED, REFUNDED or REDEEMED as paid", () => {
    for (const status of ["APPROVED", "REFUNDED", "REDEEMED", "UNDER_DISPUTE", "FAILED"] as const) {
      const failure = unwrapErr(
        verifyPixPayment({ requirements, payload, record, providerStatus: status, now: NOW }),
      );
      expect(failure.code).toBe("invalid_pix_charge_not_paid");
    }
  });

  it("rejects an asset other than BRL", () => {
    const failure = unwrapErr(
      verifyPixPayment({
        requirements: { ...requirements, asset: "USDC" },
        payload,
        record,
        providerStatus: "PAID",
        now: NOW,
      }),
    );
    expect(failure.code).toBe("unsupported_asset");
  });
});

describe("verifyPixPaymentWithProvider", () => {
  it("confirms the status with the provider before granting access", async () => {
    const stub = stubFetch([
      jsonResponse({ data: { id: CHARGE_ID, status: "PAID" }, error: null, success: true }),
    ]);
    const client = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "https://provider.test/v2",
      fetch: stub.fetch,
    });

    const result = unwrap(
      await verifyPixPaymentWithProvider(client, { requirements, payload, record, now: NOW }),
    );
    expect(result.chargeId).toBe(CHARGE_ID);
    expect(stub.calls).toHaveLength(1);
  });

  it("rejects when the provider still reports PENDING", async () => {
    const stub = stubFetch([
      jsonResponse({ data: { id: CHARGE_ID, status: "PENDING" }, error: null, success: true }),
    ]);
    const client = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "https://provider.test/v2",
      fetch: stub.fetch,
    });

    const failure = unwrapErr(
      await verifyPixPaymentWithProvider(client, { requirements, payload, record, now: NOW }),
    );
    expect(failure.kind).toBe("scheme");
    if (failure.kind === "scheme") expect(failure.failure.code).toBe("invalid_pix_charge_not_paid");
  });

  it("does not call the provider for a charge already consumed", async () => {
    const stub = stubFetch([]);
    const client = new AbacatePayClient({
      apiKey: "key",
      baseUrl: "https://provider.test/v2",
      fetch: stub.fetch,
    });

    const failure = unwrapErr(
      await verifyPixPaymentWithProvider(client, {
        requirements,
        payload,
        record: { ...record, consumedAt: NOW },
        now: NOW,
      }),
    );
    expect(failure.kind).toBe("scheme");
    expect(stub.calls).toHaveLength(0);
  });
});
