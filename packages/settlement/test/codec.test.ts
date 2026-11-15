import { describe, expect, it } from "vitest";
import {
  decodeHeader,
  decodePaymentPayload,
  decodePaymentRequired,
  decodeSettlementResponse,
  encodeHeader,
} from "../src/codec.js";
import { stellarPayload, stellarRequirements } from "./fixtures.js";

describe("encodeHeader / decodeHeader", () => {
  it("round-trips an object through base64", () => {
    const value = { x402Version: 2, accepts: [{ scheme: "exact" }] };
    const encoded = encodeHeader(value);

    expect(encoded).not.toContain("{");
    const decoded = decodeHeader(encoded);
    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.value).toEqual(value);
  });

  it("round-trips a full PaymentPayload with the seven-decimal amount intact", () => {
    const payload = stellarPayload();
    const decoded = decodePaymentPayload(encodeHeader(payload));

    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.value.accepted.amount).toBe("6800000");
  });

  it("accepts the base64url alphabet and stray whitespace", () => {
    const value = { x402Version: 2, note: "???>>>???" };
    const urlSafe = encodeHeader(value).replace(/\+/g, "-").replace(/\//g, "_");
    const decoded = decodeHeader(` ${urlSafe} `);

    expect(decoded.ok && decoded.value).toEqual(value);
  });
});

describe("decodeHeader with invalid input", () => {
  it("reports an empty header", () => {
    const decoded = decodeHeader("   ");
    expect(decoded).toEqual({ ok: false, error: { kind: "empty", message: "header is empty" } });
  });

  it("reports a header that is not base64", () => {
    const decoded = decodeHeader("{\"x402Version\":2}");
    expect(decoded.ok).toBe(false);
    expect(!decoded.ok && decoded.error.kind).toBe("not_base64");
  });

  it("reports base64 that is not JSON", () => {
    const decoded = decodeHeader(Buffer.from("not json at all", "utf8").toString("base64"));
    expect(!decoded.ok && decoded.error.kind).toBe("not_utf8_json");
  });

  it("reports JSON that is not an object", () => {
    expect(!decodeHeader(encodeHeader([1, 2, 3])).ok).toBe(true);
    const decoded = decodeHeader(encodeHeader("a string"));
    expect(!decoded.ok && decoded.error.kind).toBe("not_object");
  });

  it("never throws on truncated base64", () => {
    const truncated = encodeHeader(stellarPayload()).slice(0, 37);
    expect(() => decodeHeader(truncated)).not.toThrow();
    expect(decodeHeader(truncated).ok).toBe(false);
  });

  it("reports a well-formed object of the wrong shape", () => {
    const decoded = decodePaymentPayload(encodeHeader({ x402Version: 2 }));
    expect(!decoded.ok && decoded.error.kind).toBe("shape_mismatch");
    expect(!decoded.ok && decoded.error.message).toBe("header is not a PaymentPayload");
  });

  it("rejects a PaymentPayload whose accepted.amount is a number", () => {
    const payload = { ...stellarPayload(), accepted: { ...stellarRequirements(), amount: 6_800_000 } };
    const decoded = decodePaymentPayload(encodeHeader(payload));

    expect(!decoded.ok && decoded.error.kind).toBe("shape_mismatch");
  });
});

describe("typed decoders", () => {
  it("decodes a PaymentRequired", () => {
    const required = {
      x402Version: 2,
      error: "Free quota exhausted. Pay to continue.",
      resource: { url: "https://api.exemplo.com/v1/search" },
      accepts: [stellarRequirements()],
      extensions: {},
    };
    const decoded = decodePaymentRequired(encodeHeader(required));

    expect(decoded.ok).toBe(true);
    expect(decoded.ok && decoded.value.accepts[0]?.network).toBe("stellar:testnet");
  });

  it("decodes a SettlementResponse", () => {
    const decoded = decodeSettlementResponse(
      encodeHeader({
        success: true,
        transaction: "a".repeat(64),
        network: "stellar:testnet",
        payer: "GBHEGW3K",
      }),
    );

    expect(decoded.ok && decoded.value.success).toBe(true);
    expect(decoded.ok && decoded.value.transaction).toHaveLength(64);
  });

  it("rejects a SettlementResponse without a network", () => {
    const decoded = decodeSettlementResponse(
      encodeHeader({ success: true, transaction: "a".repeat(64) }),
    );
    expect(!decoded.ok && decoded.error.kind).toBe("shape_mismatch");
  });
});
