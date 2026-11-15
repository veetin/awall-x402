/**
 * x402 v2 protocol types.
 *
 * The structural types come from `@x402/core` (series 2.x), which mirrors
 * specs/x402-specification-v2.md field for field. Re-exporting them here keeps
 * one definition in the workspace and makes drift a compile error instead of a
 * runtime surprise. What this module adds on top is the part `@x402/core` leaves
 * as a bare `string`: the catalogue of `errorReason` / `invalidReason` codes.
 */

import type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
  SettleRequest,
  SettleResponse,
  SupportedKind,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
} from "@x402/core/types";

export type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
  SettleRequest,
  SupportedKind,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
};

/**
 * `SettlementResponse` is the name the HTTP transport and the Stellar binding
 * use for the object carried in the `PAYMENT-RESPONSE` header; `@x402/core`
 * calls the same shape `SettleResponse`.
 */
export type SettlementResponse = SettleResponse;

/** HTTP header names defined by the x402 v2 HTTP transport. */
export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

/** Protocol version this package speaks. The Stellar binding has no v1. */
export const X402_VERSION = 2;

/**
 * Error codes from section 9 of the x402 v2 specification, plus the two
 * payment-flow codes `@x402/core` 2.x emits.
 */
export const PROTOCOL_ERROR_REASONS = [
  "insufficient_funds",
  "invalid_exact_evm_payload_authorization_valid_after",
  "invalid_exact_evm_payload_authorization_valid_before",
  "invalid_exact_evm_payload_authorization_value_mismatch",
  "invalid_exact_evm_payload_signature",
  "invalid_exact_evm_payload_recipient_mismatch",
  "invalid_network",
  "invalid_payload",
  "invalid_payment_requirements",
  "invalid_scheme",
  "unsupported_scheme",
  "unsupported_asset_transfer_method",
  "unsupported_payment_flow",
  "invalid_x402_version",
  "invalid_transaction_state",
  "unexpected_verify_error",
  "unexpected_settle_error",
  "settlement_pending",
] as const;

/**
 * Verification codes of the `exact` scheme on Stellar. The binding spec names
 * only `invalid_exact_stellar_payload_fee_exceeds_maximum` in prose; the rest
 * are the codes the reference binding `@x402/stellar` 2.28.0 actually returns.
 */
export const STELLAR_VERIFY_ERROR_REASONS = [
  "invalid_exact_stellar_payload_malformed",
  "invalid_exact_stellar_payload_wrong_operation",
  "invalid_exact_stellar_payload_wrong_function_name",
  "invalid_exact_stellar_payload_wrong_asset",
  "invalid_exact_stellar_payload_wrong_recipient",
  "invalid_exact_stellar_payload_wrong_amount",
  "invalid_exact_stellar_payload_multiple_transfers",
  "invalid_exact_stellar_payload_has_subinvocations",
  "invalid_exact_stellar_payload_no_auth_entries",
  "invalid_exact_stellar_payload_missing_payer_signature",
  "invalid_exact_stellar_payload_unexpected_pending_signatures",
  "invalid_exact_stellar_payload_unsupported_credential_type",
  "invalid_exact_stellar_payload_unsafe_tx_or_op_source",
  "invalid_exact_stellar_payload_facilitator_is_payer",
  "invalid_exact_stellar_payload_facilitator_in_auth",
  "invalid_exact_stellar_payload_fee_exceeds_maximum",
  "invalid_exact_stellar_payload_simulation_failed",
  "invalid_exact_stellar_payload_no_transfer_events",
  "invalid_exact_stellar_payload_event_not_transfer",
  "invalid_exact_stellar_payload_event_missing_contract_id",
  "invalid_exact_stellar_payload_event_wrong_asset",
  "invalid_exact_stellar_payload_event_wrong_from",
  "invalid_exact_stellar_payload_event_wrong_to",
  "invalid_exact_stellar_payload_event_wrong_amount",
  "invalid_exact_stellar_signature_expiration_too_far",
] as const;

/** Settlement codes of the `exact` scheme on Stellar. */
export const STELLAR_SETTLE_ERROR_REASONS = [
  "settle_exact_stellar_signer_selection_failed",
  "settle_exact_stellar_transaction_signing_failed",
  "settle_exact_stellar_fee_bump_signing_failed",
  "settle_exact_stellar_transaction_submission_failed",
  "settle_exact_stellar_transaction_failed",
] as const;

/** Every code this package knows by name. */
export const KNOWN_ERROR_REASONS = [
  ...PROTOCOL_ERROR_REASONS,
  ...STELLAR_VERIFY_ERROR_REASONS,
  ...STELLAR_SETTLE_ERROR_REASONS,
] as const;

/** A code named by the specification or by the Stellar binding. */
export type KnownErrorReason = (typeof KNOWN_ERROR_REASONS)[number];

/**
 * An `errorReason` or `invalidReason` value. Known codes autocomplete and
 * compare exhaustively; any other string still type-checks, because the
 * catalogue is open and a facilitator may ship a code we have not seen.
 */
export type ErrorReason = KnownErrorReason | (string & {});

/**
 * Codes that do **not** mean the payment failed. `settlement_pending` says the
 * transaction was broadcast but confirmation could not be established, so the
 * caller reconciles by transaction hash instead of assuming failure.
 */
export const NON_TERMINAL_ERROR_REASONS = ["settlement_pending"] as const;

const KNOWN_ERROR_REASON_SET: ReadonlySet<string> = new Set(KNOWN_ERROR_REASONS);
const NON_TERMINAL_ERROR_REASON_SET: ReadonlySet<string> = new Set(NON_TERMINAL_ERROR_REASONS);

/**
 * Whether a string is a code this package knows by name.
 *
 * @param reason - Candidate code, typically straight from a facilitator body.
 * @returns True when the code is in the catalogue.
 */
export function isKnownErrorReason(reason: string): reason is KnownErrorReason {
  return KNOWN_ERROR_REASON_SET.has(reason);
}

/**
 * Whether a code leaves the payment undecided rather than failed.
 *
 * @param reason - Code from a `SettlementResponse`.
 * @returns True for `settlement_pending`.
 */
export function isNonTerminalErrorReason(reason: string): boolean {
  return NON_TERMINAL_ERROR_REASON_SET.has(reason);
}

/** Whether a code belongs to the `exact` scheme on Stellar. */
export function isStellarErrorReason(reason: string): boolean {
  return reason.startsWith("invalid_exact_stellar_") || reason.startsWith("settle_exact_stellar_");
}
