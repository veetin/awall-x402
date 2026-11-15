import { describe, expect, it } from "vitest";
import { buildPixRequirements } from "../src/requirements.js";

const input = {
  amountCents: 394n,
  chargeId: "ofr_01JDX7QMV3",
  checkoutUrl: "https://awall.demo/pay/ofr_01JDX7QMV3",
  statusUrl: "https://api.awall.demo/awall/offers/ofr_01JDX7QMV3",
  brCode: "00020126580014br.gov.bcb.pix...",
  expiresAt: "2026-11-28T18:42:00Z",
  maxTimeoutSeconds: 900,
};

describe("buildPixRequirements", () => {
  it("produces the object of specs/scheme_pix.md", () => {
    expect(buildPixRequirements(input)).toEqual({
      scheme: "pix",
      network: "pix:bcb",
      amount: "394",
      asset: "BRL",
      payTo: "merchant",
      maxTimeoutSeconds: 900,
      extra: {
        assetTransferMethod: "pixCharge",
        paymentFlow: "upfront",
        chargeId: "ofr_01JDX7QMV3",
        checkoutUrl: "https://awall.demo/pay/ofr_01JDX7QMV3",
        statusUrl: "https://api.awall.demo/awall/offers/ofr_01JDX7QMV3",
        brCode: "00020126580014br.gov.bcb.pix...",
        expiresAt: "2026-11-28T18:42:00Z",
      },
    });
  });

  it("serialises the JSON in the field order of the spec", () => {
    const requirements = buildPixRequirements(input);
    expect(Object.keys(requirements)).toEqual([
      "scheme",
      "network",
      "amount",
      "asset",
      "payTo",
      "maxTimeoutSeconds",
      "extra",
    ]);
    expect(Object.keys(requirements.extra)).toEqual([
      "assetTransferMethod",
      "paymentFlow",
      "chargeId",
      "checkoutUrl",
      "statusUrl",
      "brCode",
      "expiresAt",
    ]);
  });

  it("keeps the amount an integer string of centavos", () => {
    expect(buildPixRequirements({ ...input, amountCents: 1n }).amount).toBe("1");
    expect(buildPixRequirements({ ...input, amountCents: 1_000_000n }).amount).toBe("1000000");
  });

  it("omits the optional extra fields when they are absent", () => {
    const requirements = buildPixRequirements({
      amountCents: 500n,
      chargeId: "ofr_x",
      checkoutUrl: "https://awall.demo/pay/ofr_x",
      statusUrl: "https://api.awall.demo/awall/offers/ofr_x",
    });
    expect(Object.keys(requirements.extra)).toEqual([
      "assetTransferMethod",
      "paymentFlow",
      "chargeId",
      "checkoutUrl",
      "statusUrl",
    ]);
    expect(requirements.maxTimeoutSeconds).toBe(900);
  });

  it("renders a Date expiry as an RFC 3339 instant", () => {
    const requirements = buildPixRequirements({
      ...input,
      expiresAt: new Date("2026-11-28T18:42:00Z"),
    });
    expect(requirements.extra.expiresAt).toBe("2026-11-28T18:42:00.000Z");
  });

  it("refuses a window a human cannot use", () => {
    expect(() => buildPixRequirements({ ...input, maxTimeoutSeconds: 60 })).toThrow(/at least 300/);
    expect(buildPixRequirements({ ...input, maxTimeoutSeconds: 300 }).maxTimeoutSeconds).toBe(300);
  });

  it("refuses a non-positive amount", () => {
    expect(() => buildPixRequirements({ ...input, amountCents: 0n })).toThrow(RangeError);
  });
});
