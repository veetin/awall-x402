import type { AbacatePayClient, AbacatePayError } from "./client.js";
import { confirmPaid } from "./confirm.js";
import { PIX_ASSET } from "./constants.js";
import { err, ok, type Result } from "./result.js";
import {
  isPaidStatus,
  type ChargeStatus,
  type PixChargeRecord,
  type PixPaymentPayload,
  type PixPaymentRequirements,
  type PixVerificationFailure,
} from "./types.js";

export interface VerifyPixPaymentInput {
  /** The requirements the server advertised. Source of the required amount. */
  readonly requirements: PixPaymentRequirements;
  /** What the client sent back. Used for the charge reference only. */
  readonly payload: PixPaymentPayload;
  /**
   * Our own record of the charge, or `null` when no such charge exists.
   * Persistence belongs to `@awall/ledger`: this function only reads it.
   */
  readonly record: PixChargeRecord | null;
  /** Status freshly read from the provider (`confirmPaid`). */
  readonly providerStatus: ChargeStatus;
  /** Defaults to the current instant. */
  readonly now?: Date;
}

export interface PixVerificationSuccess {
  readonly chargeId: string;
  readonly amountCents: bigint;
  /** Idempotency key for the credit, per AGENTS.md rule 4. */
  readonly idempotencyKey: string;
  /** Pix end-to-end id, when the client supplied one. Reconciliation only. */
  readonly endToEndId: string | null;
}

/**
 * Applies the "Verification" section of `specs/scheme_pix.md`, in its order.
 * Pure: the caller loads the record and the provider status.
 */
export function verifyPixPayment(
  input: VerifyPixPaymentInput,
): Result<PixVerificationSuccess, PixVerificationFailure> {
  const { requirements, payload, record } = input;
  const now = input.now ?? new Date();

  if (requirements.asset !== PIX_ASSET) {
    return err({
      code: "unsupported_asset",
      message: `the pix scheme settles ${PIX_ASSET} only`,
    });
  }

  // 1. Load the charge by `payload.chargeId` from our own records.
  if (payload.chargeId.length === 0 || record === null) {
    return err({ code: "invalid_pix_charge_unknown", message: "charge is not known" });
  }
  if (record.chargeId !== payload.chargeId) {
    return err({ code: "invalid_pix_charge_unknown", message: "charge record does not match the payload" });
  }
  // The payload MUST reference the charge that was advertised.
  if (requirements.extra.chargeId !== payload.chargeId) {
    return err({
      code: "invalid_pix_charge_unknown",
      message: "payload references a charge that was not advertised",
    });
  }

  // 2. Expiry.
  if (record.expiresAt.getTime() <= now.getTime()) {
    return err({ code: "invalid_pix_charge_expired", message: "charge expired before payment" });
  }

  // 3. Single use.
  if (record.consumedAt !== null) {
    return err({ code: "invalid_pix_charge_already_consumed", message: "charge already granted access" });
  }

  // 4. Amount, taken from our record and never from the client payload.
  const required = parseAmount(requirements.amount);
  if (required === null) {
    return err({
      code: "invalid_pix_charge_amount_mismatch",
      message: "required amount is not an integer string of centavos",
    });
  }
  if (record.amountCents !== required) {
    return err({
      code: "invalid_pix_charge_amount_mismatch",
      message: "recorded charge amount differs from the required amount",
    });
  }

  // 5 and 6. Only an explicit paid state counts as paid.
  if (!isPaidStatus(input.providerStatus)) {
    return err({ code: "invalid_pix_charge_not_paid", message: `charge status is ${input.providerStatus}` });
  }

  return ok({
    chargeId: record.chargeId,
    amountCents: record.amountCents,
    idempotencyKey: `pix:${record.chargeId}`,
    endToEndId: payload.endToEndId ?? null,
  });
}

export type VerifyWithProviderFailure =
  | { readonly kind: "scheme"; readonly failure: PixVerificationFailure }
  | { readonly kind: "provider"; readonly error: AbacatePayError };

/**
 * Same checks, with step 5 performed against the provider. The provider is
 * queried only after the local checks pass, so an expired or already consumed
 * charge costs no API call.
 */
export async function verifyPixPaymentWithProvider(
  client: AbacatePayClient,
  input: Omit<VerifyPixPaymentInput, "providerStatus">,
): Promise<Result<PixVerificationSuccess, VerifyWithProviderFailure>> {
  const local = verifyPixPayment({ ...input, providerStatus: "PAID" });
  if (!local.ok) return err({ kind: "scheme", failure: local.error });

  const confirmation = await confirmPaid(client, local.value.chargeId);
  if (!confirmation.ok) return err({ kind: "provider", error: confirmation.error });

  const confirmed = verifyPixPayment({ ...input, providerStatus: confirmation.value.status });
  if (!confirmed.ok) return err({ kind: "scheme", failure: confirmed.error });
  return ok(confirmed.value);
}

function parseAmount(amount: string): bigint | null {
  if (!/^\d+$/.test(amount)) return null;
  return BigInt(amount);
}
