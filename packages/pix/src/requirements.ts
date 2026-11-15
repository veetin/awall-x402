import {
  DEFAULT_MAX_TIMEOUT_SECONDS,
  MIN_MAX_TIMEOUT_SECONDS,
  PIX_ASSET,
  PIX_ASSET_TRANSFER_METHOD,
  PIX_NETWORK,
  PIX_PAYMENT_FLOW,
  PIX_PAY_TO,
  PIX_SCHEME,
} from "./constants.js";
import type { PixPaymentRequirements } from "./types.js";

export interface BuildPixRequirementsInput {
  /** Amount in centavos, serialised as an integer string. Never a float. */
  readonly amountCents: bigint;
  readonly chargeId: string;
  /** HTTPS page a human opens to pay. */
  readonly checkoutUrl: string;
  /** HTTPS endpoint the client polls for charge status. */
  readonly statusUrl: string;
  /** Pix copy-and-paste payload, when the server can emit it inline. */
  readonly brCode?: string;
  /** Absolute expiry of the charge. */
  readonly expiresAt?: Date | string;
  /** Advertised window. At least 300 s, per the spec. */
  readonly maxTimeoutSeconds?: number;
}

/**
 * Builds the `PaymentRequirements` entry of the `pix` scheme, exactly as
 * `specs/scheme_pix.md` defines it. Invalid input is a programming error here
 * and throws: a malformed offer must never reach a client.
 */
export function buildPixRequirements(input: BuildPixRequirementsInput): PixPaymentRequirements {
  if (input.amountCents <= 0n) {
    throw new RangeError("amountCents must be a positive integer of centavos");
  }
  if (input.chargeId.length === 0) {
    throw new TypeError("chargeId is required");
  }
  if (input.checkoutUrl.length === 0 || input.statusUrl.length === 0) {
    throw new TypeError("checkoutUrl and statusUrl are required");
  }
  const maxTimeoutSeconds = input.maxTimeoutSeconds ?? DEFAULT_MAX_TIMEOUT_SECONDS;
  if (!Number.isInteger(maxTimeoutSeconds) || maxTimeoutSeconds < MIN_MAX_TIMEOUT_SECONDS) {
    throw new RangeError(`maxTimeoutSeconds must be an integer of at least ${MIN_MAX_TIMEOUT_SECONDS}`);
  }

  const expiresAt = normaliseInstant(input.expiresAt);

  return {
    scheme: PIX_SCHEME,
    network: PIX_NETWORK,
    amount: input.amountCents.toString(),
    asset: PIX_ASSET,
    payTo: PIX_PAY_TO,
    maxTimeoutSeconds,
    extra: {
      assetTransferMethod: PIX_ASSET_TRANSFER_METHOD,
      paymentFlow: PIX_PAYMENT_FLOW,
      chargeId: input.chargeId,
      checkoutUrl: input.checkoutUrl,
      statusUrl: input.statusUrl,
      ...(input.brCode === undefined ? {} : { brCode: input.brCode }),
      ...(expiresAt === undefined ? {} : { expiresAt }),
    },
  };
}

function normaliseInstant(value: Date | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") {
    if (Number.isNaN(Date.parse(value))) throw new TypeError("expiresAt is not an instant");
    return value;
  }
  if (Number.isNaN(value.getTime())) throw new TypeError("expiresAt is not an instant");
  return value.toISOString();
}
