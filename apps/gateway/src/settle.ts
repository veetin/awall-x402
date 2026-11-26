import {
  getOffer,
  grantCredits,
  promotePendingPayment,
  type Database,
  type Offer,
} from "@awall/ledger";
import {
  HEADER_PAYMENT_RESPONSE,
  decodePaymentPayload,
  encodeHeader,
  revalidateAccepted,
  type FacilitatorClient,
  type PaymentPayload,
  type SettlementResponse,
} from "@awall/settlement";
import { exactRequirementsForAsset } from "./x402.js";

export type SettleSuccess = {
  ok: true;
  offer: Offer;
  balance: bigint;
  response: SettlementResponse;
  /** Asset and amount that were actually settled (USDC or XLM). */
  paid: { amount: string; asset: string };
};

export type SettleFailure = {
  ok: false;
  status: 402;
  error: string;
  errorReason: string;
  response?: SettlementResponse;
};

/**
 * Verify and settle a `PAYMENT-SIGNATURE`, then credit the pack.
 *
 * The amount charged is the stored offer's. A client that rewrites `amount`
 * fails revalidation and is not billed. A facilitator that is down, answers
 * garbage, or returns `settlement_pending` never produces a credit and never
 * a 500: the caller turns the failure into a 402.
 *
 * The offer must belong to the identity making the request. Otherwise the
 * credits would land on another identity and this request would still be
 * refused, so the payer would pay for nothing. The mismatch is refused before
 * `/verify`, while the client still holds its money.
 *
 * @param db - Ledger connection.
 * @param facilitator - Facilitator client, or null when none is configured.
 * @param header - Raw `PAYMENT-SIGNATURE` header.
 * @param identityId - Identity of the request that carries the header.
 * @returns The credited offer, or a 402 reason.
 */
export async function settlePayment(
  db: Database,
  facilitator: FacilitatorClient | null,
  header: string,
  identityId: string,
): Promise<SettleSuccess | SettleFailure> {
  const decoded = decodePaymentPayload(header);
  if (!decoded.ok) {
    return fail("invalid_payload", "invalid_payload");
  }
  const payload = decoded.value;
  if (payload.accepted.scheme !== "exact") {
    return fail(
      "pix_settles_via_webhook",
      "unsupported_scheme",
      receipt(payload.accepted.network, "unsupported_scheme"),
    );
  }

  const offerId = readOfferId(payload);
  if (!offerId) return fail("missing_offer", "invalid_payment_requirements");

  const offer = await getOffer(db, offerId);
  if (!offer) return fail("offer_not_found", "invalid_payment_requirements");
  if (offer.status === "expired") return fail("offer_expired", "invalid_payment_requirements");
  if (offer.identityId !== identityId) {
    return fail(
      "offer_identity_mismatch",
      "invalid_payment_requirements",
      receipt(offer.network, "invalid_payment_requirements"),
    );
  }

  const expected = exactRequirementsForAsset(offer, payload.accepted.asset);
  if (!expected) {
    return fail(
      "unsupported_asset",
      "invalid_payment_requirements",
      receipt(offer.network, "invalid_payment_requirements"),
    );
  }
  const revalidated = revalidateAccepted(payload.accepted, expected);
  if (!revalidated.ok) {
    return fail(
      `terms_diverged:${revalidated.field}`,
      revalidated.errorReason,
      receipt(expected.network, revalidated.errorReason),
    );
  }

  if (!facilitator) {
    return fail("facilitator_unavailable", "unexpected_verify_error", receipt(expected.network, "unexpected_verify_error"));
  }

  const verified = await facilitator.verify(payload, expected);
  if (!verified.ok) {
    return fail(
      `facilitator_${verified.failure.kind}`,
      "unexpected_verify_error",
      receipt(expected.network, "unexpected_verify_error"),
    );
  }
  if (verified.value.status === "invalid") {
    return fail(
      verified.value.invalidReason,
      verified.value.invalidReason,
      receipt(expected.network, verified.value.invalidReason),
    );
  }

  const settled = await facilitator.settle(payload, expected);
  if (!settled.ok) {
    return fail(
      `facilitator_${settled.failure.kind}`,
      "unexpected_settle_error",
      receipt(expected.network, "unexpected_settle_error"),
    );
  }

  if (settled.value.status === "pending") {
    if (settled.value.reconcilable) {
      await grantCredits(db, {
        identityId: offer.identityId,
        offerId: offer.id,
        credits: offer.packCredits,
        payment: {
          rail: "exact",
          amount: expected.amount,
          asset: expected.asset,
          network: offer.network,
          idempotencyKey: settled.value.transaction,
          txHash: settled.value.transaction,
          payer: settled.value.payer ?? null,
          settleResponse: settled.value.response,
          status: "pending",
          errorReason: settled.value.errorReason,
        },
      });
    }
    return fail("settlement_pending", "settlement_pending", settled.value.response);
  }

  if (settled.value.status === "failed") {
    // Namespaced: a terminal failure must not take the transaction hash, or a
    // later settle of the same hash would collide with it and never credit.
    const key = `failed:${settled.value.transaction || offer.id}:${settled.value.errorReason}`;
    await grantCredits(db, {
      identityId: offer.identityId,
      offerId: offer.id,
      credits: offer.packCredits,
      payment: {
        rail: "exact",
        amount: expected.amount,
        asset: expected.asset,
        network: offer.network,
        idempotencyKey: key,
        txHash: settled.value.transaction || null,
        payer: settled.value.payer ?? null,
        settleResponse: settled.value.response,
        status: "failed",
        errorReason: settled.value.errorReason,
      },
    });
    return fail(settled.value.errorReason, settled.value.errorReason, settled.value.response);
  }

  if (!settled.value.transaction) {
    return fail("missing_transaction", "unexpected_settle_error", settled.value.response);
  }

  const pending = await promotePendingPayment(db, {
    idempotencyKey: settled.value.transaction,
    payer: settled.value.payer ?? null,
    settleResponse: settled.value.response,
  });
  const paid = { amount: expected.amount, asset: expected.asset };
  if (pending.ok) {
    return {
      ok: true,
      offer,
      balance: pending.balanceAfter,
      response: settled.value.response,
      paid,
    };
  }

  const granted = await grantCredits(db, {
    identityId: offer.identityId,
    offerId: offer.id,
    credits: offer.packCredits,
    payment: {
      rail: "exact",
      amount: expected.amount,
      asset: expected.asset,
      network: offer.network,
      idempotencyKey: settled.value.transaction,
      txHash: settled.value.transaction,
      payer: settled.value.payer ?? null,
      settleResponse: settled.value.response,
      status: "settled",
    },
  });
  return {
    ok: true,
    offer,
    balance: granted.balanceAfter,
    response: settled.value.response,
    paid,
  };
}

/** Header value for a settlement receipt. */
export function paymentResponseHeader(response: SettlementResponse | undefined): string | undefined {
  if (!response) return undefined;
  return encodeHeader(response);
}

export { HEADER_PAYMENT_RESPONSE };

/**
 * Offer the payload says it pays for.
 *
 * @param payload - Decoded `PAYMENT-SIGNATURE`.
 * @returns The offer id, or `undefined` when the payload names none.
 */
export function readOfferId(payload: PaymentPayload): string | undefined {
  const id = payload.accepted.extra["offerId"];
  return typeof id === "string" && id.length > 0 ? id : undefined;
}

function receipt(network: string, errorReason: string): SettlementResponse {
  return {
    success: false,
    transaction: "",
    network: network as `${string}:${string}`,
    errorReason,
  };
}

function fail(
  error: string,
  errorReason: string,
  response?: SettlementResponse,
): SettleFailure {
  return { ok: false, status: 402, error, errorReason, ...(response ? { response } : {}) };
}
