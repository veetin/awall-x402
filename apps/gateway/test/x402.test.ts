import { describe, expect, it } from "vitest";
import { decodeHeader, encodeHeader } from "../src/x402.js";

describe("x402 header codec", () => {
  it("round-trips an object through base64", () => {
    const value = { x402Version: 2, accepts: [{ scheme: "exact" }] };
    const encoded = encodeHeader(value);
    expect(encoded).not.toContain("{");
    expect(decodeHeader(encoded)).toEqual(value);
  });

  it("decodes the example from the HTTP transport spec", () => {
    const decoded = decodeHeader<{ x402Version: number }>(
      encodeHeader({ x402Version: 2, error: "PAYMENT-SIGNATURE header is required" }),
    );
    expect(decoded.x402Version).toBe(2);
  });
});
