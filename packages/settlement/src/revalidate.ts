/**
 * Revalidation of the client-supplied `accepted` object.
 *
 * The `accepted` field inside `PAYMENT-SIGNATURE` is whatever the client chose
 * to send. It is echoed terms, not a source of truth. Before any facilitator
 * call, the server compares it field by field against the terms it issued, and
 * the amount compared against is always the server's — a client that rewrites
 * `amount` downward must be rejected, not billed its own figure.
 */

import type { ErrorReason, PaymentRequirements } from "./types.js";

/** The fields of `accepted` that must match the issued terms exactly. */
export type RevalidatedField = "scheme" | "network" | "asset" | "payTo" | "amount" | "maxTimeoutSeconds";

/** Outcome of revalidation. */
export type RevalidationResult =
  | { ok: true }
  | {
      ok: false;
      /** The first field that diverged, in the order declared above. */
      field: RevalidatedField;
      /** What the server issued. */
      expected: string;
      /** What the client sent back. */
      received: string;
      /** The code to report in the 402. */
      errorReason: ErrorReason;
    };

const ERROR_REASON_BY_FIELD: Readonly<Record<RevalidatedField, ErrorReason>> = {
  scheme: "invalid_scheme",
  network: "invalid_network",
  asset: "invalid_payment_requirements",
  payTo: "invalid_payment_requirements",
  amount: "invalid_payment_requirements",
  maxTimeoutSeconds: "invalid_payment_requirements",
};

/**
 * Compare the client's `accepted` object with the terms the server issued.
 *
 * Comparison is exact string equality, including for `amount`: `"06800000"` is
 * a divergence from `"6800000"`, not a match. Numeric comparison would accept
 * re-encoded amounts and give a tampering client a second chance.
 *
 * `extra` is not compared. It carries scheme-specific data plus our own
 * `offerId` and `packCredits`, and the fields that decide money are the six
 * above; the offer identity is resolved from the stored offer, not from `extra`.
 *
 * @param accepted - The `accepted` object taken from the client's `PaymentPayload`.
 * @param expected - The `PaymentRequirements` the server issued for this offer,
 *   with `amount` read back from the stored offer.
 * @returns `ok`, or the first divergent field with the code to report.
 */
export function revalidateAccepted(
  accepted: PaymentRequirements,
  expected: PaymentRequirements,
): RevalidationResult {
  if (accepted.scheme !== expected.scheme) {
    return divergence("scheme", expected.scheme, accepted.scheme);
  }
  if (accepted.network !== expected.network) {
    return divergence("network", expected.network, accepted.network);
  }
  if (accepted.asset !== expected.asset) {
    return divergence("asset", expected.asset, accepted.asset);
  }
  if (accepted.payTo !== expected.payTo) {
    return divergence("payTo", expected.payTo, accepted.payTo);
  }
  if (accepted.amount !== expected.amount) {
    return divergence("amount", expected.amount, accepted.amount);
  }
  if (accepted.maxTimeoutSeconds !== expected.maxTimeoutSeconds) {
    return divergence(
      "maxTimeoutSeconds",
      String(expected.maxTimeoutSeconds),
      String(accepted.maxTimeoutSeconds),
    );
  }
  return { ok: true };
}

/**
 * Build a divergence result.
 *
 * @param field - The field that diverged.
 * @param expected - The server's value.
 * @param received - The client's value.
 * @returns The failed revalidation result.
 */
function divergence(
  field: RevalidatedField,
  expected: string,
  received: string,
): RevalidationResult {
  return { ok: false, field, expected, received, errorReason: ERROR_REASON_BY_FIELD[field] };
}
