import { describe, expect, it } from "vitest";
import type { SupportedResponse } from "../src/types.js";
import {
  STELLAR_USDC_DECIMALS,
  checkFacilitatorSupport,
  checkStellarExactSupport,
  hasSponsoredFees,
  isStellarExact,
  isStellarNetwork,
} from "../src/stellar.js";
import { stellarRequirements } from "./fixtures.js";

/**
 * Build a `/supported` response.
 *
 * @param kinds - Pairs the facilitator advertises.
 * @returns A `SupportedResponse`.
 */
function supported(kinds: SupportedResponse["kinds"]): SupportedResponse {
  return { kinds, extensions: [], signers: {} };
}

describe("isStellarExact", () => {
  it("accepts exact on a Stellar network", () => {
    expect(isStellarExact(stellarRequirements())).toBe(true);
    expect(isStellarExact(stellarRequirements({ network: "stellar:pubnet" }))).toBe(true);
  });

  it("rejects a scheme with no Stellar binding", () => {
    expect(isStellarExact(stellarRequirements({ scheme: "upto" }))).toBe(false);
    expect(isStellarExact(stellarRequirements({ scheme: "auth-capture" }))).toBe(false);
  });

  it("rejects exact on another namespace", () => {
    expect(isStellarExact(stellarRequirements({ network: "eip155:8453" }))).toBe(false);
  });

  it("rejects the pix rail", () => {
    const pix = stellarRequirements({ scheme: "pix", network: "pix:bcb", asset: "BRL" });
    expect(isStellarExact(pix)).toBe(false);
  });

  it("does not match a namespace that merely starts with stellar", () => {
    expect(isStellarNetwork("stellarish:testnet")).toBe(false);
  });
});

describe("hasSponsoredFees", () => {
  it("requires extra.areFeesSponsored to be exactly true", () => {
    expect(hasSponsoredFees(stellarRequirements())).toBe(true);
    expect(hasSponsoredFees(stellarRequirements({ extra: {} }))).toBe(false);
    expect(hasSponsoredFees(stellarRequirements({ extra: { areFeesSponsored: "true" } }))).toBe(false);
  });
});

describe("checkFacilitatorSupport", () => {
  const stellarKind = { x402Version: 2, scheme: "exact", network: "stellar:testnet" } as const;

  it("confirms the configured pair", () => {
    const result = checkStellarExactSupport(supported([stellarKind]), "stellar:testnet");

    expect(result.supported).toBe(true);
    expect(result.supported && result.kind.network).toBe("stellar:testnet");
  });

  it("reports a network the facilitator does not serve", () => {
    const result = checkStellarExactSupport(supported([stellarKind]), "stellar:pubnet");

    expect(result).toEqual({ supported: false, reason: "network_not_supported" });
  });

  it("reports a scheme the facilitator does not serve on that network", () => {
    const result = checkFacilitatorSupport(supported([stellarKind]), "upto", "stellar:testnet");

    expect(result).toEqual({ supported: false, reason: "scheme_not_supported" });
  });

  it("reports a pair advertised only for another protocol version", () => {
    const v1Only = { x402Version: 1, scheme: "exact", network: "stellar:testnet" } as const;

    const result = checkStellarExactSupport(supported([v1Only]), "stellar:testnet");

    expect(result).toEqual({ supported: false, reason: "x402_version_not_supported" });
  });

  it("reports an empty catalogue as an unsupported network", () => {
    expect(checkStellarExactSupport(supported([]), "stellar:testnet")).toEqual({
      supported: false,
      reason: "network_not_supported",
    });
  });
});

describe("STELLAR_USDC_DECIMALS", () => {
  it("is seven, so 0.50 USDC is 5000000 atomic units", () => {
    expect(STELLAR_USDC_DECIMALS).toBe(7);
    expect((50n * 10n ** BigInt(STELLAR_USDC_DECIMALS)) / 100n).toBe(5_000_000n);
  });
});
