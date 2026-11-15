/** Scheme identifiers, fixed by `specs/scheme_pix.md`. */
export const PIX_SCHEME = "pix";
export const PIX_NETWORK = "pix:bcb";
export const PIX_ASSET = "BRL";
export const PIX_ASSET_TRANSFER_METHOD = "pixCharge";
export const PIX_PAYMENT_FLOW = "upfront";
export const PIX_PAY_TO = "merchant";

/**
 * The spec says `maxTimeoutSeconds` SHOULD be at least 300, and AbacatePay
 * rejects `expiresIn` below 300 seconds. Same floor on both sides.
 */
export const MIN_MAX_TIMEOUT_SECONDS = 300;

/** Default advertised window: 15 minutes, as in the spec example. */
export const DEFAULT_MAX_TIMEOUT_SECONDS = 900;

/** AbacatePay rejects charges below R$ 1,00. */
export const MIN_AMOUNT_CENTS = 100n;

/** Documented AbacatePay v2 base URL. */
export const ABACATEPAY_BASE_URL = "https://api.abacatepay.com/v2";
