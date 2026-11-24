import { describe, expect, it } from "vitest";
import { decodeHeader, encodeHeader } from "@awall/settlement";

describe("x402 header codec", () => {
  it("round-trips an object through base64", () => {
    const value = { x402Version: 2, accepts: [{ scheme: "exact" }] };
    const encoded = encodeHeader(value);
    expect(encoded).not.toContain("{");
    const decoded = decodeHeader(encoded);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value["x402Version"]).toBe(2);
  });

  it("decodes the example from the HTTP transport spec", () => {
    const decoded = decodeHeader(
      encodeHeader({ x402Version: 2, error: "PAYMENT-SIGNATURE header is required" }),
    );
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.value["x402Version"]).toBe(2);
  });
});
