/**
 * `@awall/settlement` — the server side of x402 settlement, as a pure library.
 *
 * This package owns the x402 v2 protocol types, the header codec, the
 * facilitator client and the revalidation of client-supplied terms. It performs
 * no I/O of its own beyond the `fetch` handed to {@link FacilitatorClient}, and
 * it knows nothing about Hono, Postgres or the credit ledger.
 */

export {
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  KNOWN_ERROR_REASONS,
  NON_TERMINAL_ERROR_REASONS,
  PROTOCOL_ERROR_REASONS,
  STELLAR_SETTLE_ERROR_REASONS,
  STELLAR_VERIFY_ERROR_REASONS,
  X402_VERSION,
  isKnownErrorReason,
  isNonTerminalErrorReason,
  isStellarErrorReason,
} from "./types.js";

export type {
  ErrorReason,
  KnownErrorReason,
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements,
  ResourceInfo,
  SettleRequest,
  SettlementResponse,
  SupportedKind,
  SupportedResponse,
  VerifyRequest,
  VerifyResponse,
} from "./types.js";

export {
  decodeHeader,
  decodeHeaderAs,
  decodePaymentPayload,
  decodePaymentRequired,
  decodeSettlementResponse,
  encodeHeader,
  isPaymentPayload,
  isPaymentRequired,
  isPaymentRequirements,
  isSettlementResponse,
} from "./codec.js";

export type { DecodeError, DecodeErrorKind, DecodeResult } from "./codec.js";

export { DEFAULT_TIMEOUT_MS, FacilitatorClient } from "./facilitator.js";

export type {
  FacilitatorClientOptions,
  FacilitatorFailure,
  FacilitatorResult,
  SettleOutcome,
  VerifyOutcome,
} from "./facilitator.js";

export { revalidateAccepted } from "./revalidate.js";

export type { RevalidatedField, RevalidationResult } from "./revalidate.js";

export {
  STELLAR_NAMESPACE,
  STELLAR_SCHEME,
  STELLAR_USDC_DECIMALS,
  checkFacilitatorSupport,
  checkStellarExactSupport,
  hasSponsoredFees,
  isStellarExact,
  isStellarNetwork,
} from "./stellar.js";

export type { SupportCheck, UnsupportedPairReason } from "./stellar.js";
