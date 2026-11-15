import type { PaymentPayload, PaymentRequirements } from "../src/types.js";

/** Testnet USDC SAC. Seven decimals: `"6800000"` is 0.68 USDC. */
export const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

/** Receiving account of the demo deployment. */
export const PAY_TO = "GBHEGW3KWOY2OFH767EDALFGCUTBOEVBDQMCKU4APMDLQNBW5QV3W3KO";

/** The address that signed the auth entries. */
export const PAYER = "GAXKWWJZJFQ6ZTZ2PGLQ2VKKFRLB7MSRC5YQSTBD4GVHB7XQMBUCPZC6";

/**
 * Build the `exact` requirement the gateway issues for a Stellar payment.
 *
 * @param overrides - Fields to replace, to build a tampered copy.
 * @returns A `PaymentRequirements` object.
 */
export function stellarRequirements(
  overrides: Partial<PaymentRequirements> = {},
): PaymentRequirements {
  return {
    scheme: "exact",
    network: "stellar:testnet",
    amount: "6800000",
    asset: USDC_TESTNET,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    extra: { areFeesSponsored: true, packCredits: 10_000, offerId: "ofr_01JDX7" },
    ...overrides,
  };
}

/**
 * Build the `PaymentPayload` a client sends in `PAYMENT-SIGNATURE`.
 *
 * @param accepted - The terms the client echoes back.
 * @returns A `PaymentPayload` object.
 */
export function stellarPayload(accepted: PaymentRequirements = stellarRequirements()): PaymentPayload {
  return {
    x402Version: 2,
    resource: { url: "https://api.exemplo.com/v1/search?q=camera" },
    accepted,
    payload: { transaction: "AAAAAgAAAABriIN4poutFUmHfB6FbFJu8GgXoPPTGQWREqFpPfvO1A" },
    extensions: {},
  };
}
