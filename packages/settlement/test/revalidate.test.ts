import { describe, expect, it } from "vitest";
import { revalidateAccepted } from "../src/revalidate.js";
import { PAY_TO, USDC_TESTNET, stellarRequirements } from "./fixtures.js";

describe("revalidateAccepted", () => {
  it("accepts terms echoed back unchanged", () => {
    expect(revalidateAccepted(stellarRequirements(), stellarRequirements())).toEqual({ ok: true });
  });

  it("accepts a different extra: only the six money fields are compared", () => {
    const accepted = stellarRequirements({ extra: { areFeesSponsored: true } });

    expect(revalidateAccepted(accepted, stellarRequirements())).toEqual({ ok: true });
  });

  it("rejects a tampered amount and reports the server's figure", () => {
    const accepted = stellarRequirements({ amount: "1" });

    const result = revalidateAccepted(accepted, stellarRequirements());

    expect(result).toEqual({
      ok: false,
      field: "amount",
      expected: "6800000",
      received: "1",
      errorReason: "invalid_payment_requirements",
    });
  });

  it("rejects an amount re-encoded with a leading zero", () => {
    const result = revalidateAccepted(stellarRequirements({ amount: "06800000" }), stellarRequirements());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("amount");
  });

  it("rejects an EVM six-decimal amount for the same nominal price", () => {
    const result = revalidateAccepted(stellarRequirements({ amount: "680000" }), stellarRequirements());

    expect(result.ok).toBe(false);
    expect(!result.ok && result.received).toBe("680000");
  });

  it("rejects a divergent scheme", () => {
    const result = revalidateAccepted(stellarRequirements({ scheme: "upto" }), stellarRequirements());

    expect(result).toEqual({
      ok: false,
      field: "scheme",
      expected: "exact",
      received: "upto",
      errorReason: "invalid_scheme",
    });
  });

  it("rejects a divergent network", () => {
    const result = revalidateAccepted(
      stellarRequirements({ network: "stellar:pubnet" }),
      stellarRequirements(),
    );

    expect(result).toEqual({
      ok: false,
      field: "network",
      expected: "stellar:testnet",
      received: "stellar:pubnet",
      errorReason: "invalid_network",
    });
  });

  it("rejects a divergent asset", () => {
    const result = revalidateAccepted(
      stellarRequirements({ asset: "CDIFFERENTTOKENADDRESS" }),
      stellarRequirements(),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("asset");
    expect(!result.ok && result.expected).toBe(USDC_TESTNET);
  });

  it("rejects a divergent payTo", () => {
    const result = revalidateAccepted(
      stellarRequirements({ payTo: "GATTACKERACCOUNT" }),
      stellarRequirements(),
    );

    expect(result.ok).toBe(false);
    expect(!result.ok && result.field).toBe("payTo");
    expect(!result.ok && result.expected).toBe(PAY_TO);
  });

  it("rejects a divergent maxTimeoutSeconds", () => {
    const result = revalidateAccepted(
      stellarRequirements({ maxTimeoutSeconds: 86_400 }),
      stellarRequirements(),
    );

    expect(result).toEqual({
      ok: false,
      field: "maxTimeoutSeconds",
      expected: "60",
      received: "86400",
      errorReason: "invalid_payment_requirements",
    });
  });

  it("reports scheme first when several fields diverge", () => {
    const accepted = stellarRequirements({ scheme: "pix", network: "pix:bcb", amount: "1" });

    const result = revalidateAccepted(accepted, stellarRequirements());

    expect(!result.ok && result.field).toBe("scheme");
  });

  it("compares against the server's amount, not the client's", () => {
    // The gateway reads `expected.amount` back from the stored offer; the client
    // controls only `accepted`. Swapping the arguments must flip the verdict.
    const serverTerms = stellarRequirements({ amount: "6800000" });
    const clientTerms = stellarRequirements({ amount: "1" });

    expect(revalidateAccepted(clientTerms, serverTerms).ok).toBe(false);
    expect(!revalidateAccepted(clientTerms, serverTerms).ok).toBe(true);
    const swapped = revalidateAccepted(serverTerms, clientTerms);
    expect(!swapped.ok && swapped.expected).toBe("1");
  });
});
