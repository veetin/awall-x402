import { describe, expect, it } from "vitest";
import {
  KNOWN_ERROR_REASONS,
  isKnownErrorReason,
  isNonTerminalErrorReason,
  isStellarErrorReason,
} from "../src/types.js";

describe("error reason catalogue", () => {
  it("has no duplicates", () => {
    expect(new Set(KNOWN_ERROR_REASONS).size).toBe(KNOWN_ERROR_REASONS.length);
  });

  it("carries the codes named in section 9 of the specification", () => {
    for (const reason of [
      "insufficient_funds",
      "invalid_network",
      "invalid_payload",
      "invalid_payment_requirements",
      "invalid_scheme",
      "unsupported_scheme",
      "invalid_x402_version",
      "invalid_transaction_state",
      "unexpected_verify_error",
      "unexpected_settle_error",
      "settlement_pending",
    ]) {
      expect(isKnownErrorReason(reason)).toBe(true);
    }
  });

  it("carries the Stellar binding codes", () => {
    expect(isKnownErrorReason("invalid_exact_stellar_payload_fee_exceeds_maximum")).toBe(true);
    expect(isKnownErrorReason("invalid_exact_stellar_payload_wrong_amount")).toBe(true);
    expect(isKnownErrorReason("invalid_exact_stellar_signature_expiration_too_far")).toBe(true);
    expect(isKnownErrorReason("settle_exact_stellar_transaction_failed")).toBe(true);
  });

  it("does not claim an invented code", () => {
    expect(isKnownErrorReason("invalid_vibes")).toBe(false);
  });

  it("treats settlement_pending as the only non-terminal code", () => {
    expect(isNonTerminalErrorReason("settlement_pending")).toBe(true);
    for (const reason of KNOWN_ERROR_REASONS.filter((code) => code !== "settlement_pending")) {
      expect(isNonTerminalErrorReason(reason)).toBe(false);
    }
  });

  it("tells Stellar codes from the rest", () => {
    expect(isStellarErrorReason("invalid_exact_stellar_payload_malformed")).toBe(true);
    expect(isStellarErrorReason("settle_exact_stellar_transaction_failed")).toBe(true);
    expect(isStellarErrorReason("invalid_exact_evm_payload_signature")).toBe(false);
    expect(isStellarErrorReason("insufficient_funds")).toBe(false);
  });
});
