import type { PixErrorCode } from "./errors.js";

/**
 * Charge status values documented for AbacatePay v2 (`GET /v2/transparents/check`).
 * `APPROVED` is a card-only intermediate state and is NOT a paid state for Pix.
 */
export type ChargeStatus =
  | "PENDING"
  | "EXPIRED"
  | "CANCELLED"
  | "PAID"
  | "UNDER_DISPUTE"
  | "REFUNDED"
  | "REDEEMED"
  | "APPROVED"
  | "FAILED";

export const CHARGE_STATUSES: readonly ChargeStatus[] = [
  "PENDING",
  "EXPIRED",
  "CANCELLED",
  "PAID",
  "UNDER_DISPUTE",
  "REFUNDED",
  "REDEEMED",
  "APPROVED",
  "FAILED",
];

/** Only an explicit paid state counts as paid (spec, Verification step 5). */
export function isPaidStatus(status: ChargeStatus): boolean {
  return status === "PAID";
}

/** A Pix charge as created by the provider. Amounts in centavos. */
export interface PixCharge {
  readonly chargeId: string;
  readonly amountCents: bigint;
  readonly status: ChargeStatus;
  /** Pix copy-and-paste payload (EMV QR), `data.brCode` in the provider response. */
  readonly brCode: string;
  /** QR code image as a data URI, `data.brCodeBase64` in the provider response. */
  readonly brCodeBase64: string | null;
  /** RFC 3339 instant, `data.expiresAt` in the provider response. */
  readonly expiresAt: string;
  /** `true` when the charge was created with a test-mode key. */
  readonly devMode: boolean;
}

/** What `GET /v2/transparents/check` reports. */
export interface PixChargeStatus {
  readonly chargeId: string;
  readonly status: ChargeStatus;
  readonly expiresAt: string | null;
}

/**
 * Our own record of a charge, as persisted by `@awall/ledger`. Verification
 * reads amount and expiry from here, never from the client payload.
 */
export interface PixChargeRecord {
  readonly chargeId: string;
  readonly amountCents: bigint;
  readonly expiresAt: Date;
  /** Set once the charge has granted access. */
  readonly consumedAt: Date | null;
}

/** The `accepted`/`PaymentRequirements` object advertised for this scheme. */
export interface PixPaymentRequirements {
  readonly scheme: "pix";
  readonly network: "pix:bcb";
  readonly amount: string;
  readonly asset: string;
  readonly payTo: string;
  readonly maxTimeoutSeconds: number;
  readonly extra: PixPaymentRequirementsExtra;
}

export interface PixPaymentRequirementsExtra {
  readonly assetTransferMethod: "pixCharge";
  readonly paymentFlow: "upfront";
  readonly chargeId: string;
  readonly checkoutUrl: string;
  readonly statusUrl: string;
  readonly brCode?: string;
  readonly expiresAt?: string;
}

/** `payload` of the x402 payment payload for the `pix` scheme. */
export interface PixPaymentPayload {
  readonly chargeId: string;
  readonly endToEndId?: string;
}

export interface PixVerificationFailure {
  readonly code: PixErrorCode;
  readonly message: string;
}
