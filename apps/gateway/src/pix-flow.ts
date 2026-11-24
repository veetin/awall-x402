import {
  attachPixCharge,
  closeOffer,
  findOfferByPixCharge,
  getOffer,
  grantCredits,
  markOfferPaidLate,
  type Database,
  type Offer,
} from "@awall/ledger";
import {
  MIN_AMOUNT_CENTS,
  confirmPaid,
  verifyWebhook,
  type AbacatePayClient,
} from "@awall/pix";
import type { GatewayConfig } from "./config.js";
import { log } from "./log.js";

/**
 * Create the Pix charge for an offer and store its id and copy-and-paste code.
 *
 * A missing client, or a provider error, leaves the offer without a charge.
 * The 402 still advertises the rail, with a local charge id, so the exact
 * rail is never blocked by the Pix provider.
 *
 * @param db - Ledger connection.
 * @param pix - AbacatePay client, or null.
 * @param offer - Offer just created.
 * @returns The offer, with the charge attached when the provider accepted it.
 */
export async function createPixCharge(
  db: Database,
  pix: AbacatePayClient | null,
  offer: Offer,
): Promise<Offer> {
  if (!pix) return offer;
  if (BigInt(offer.priceBrlCents) < MIN_AMOUNT_CENTS) return offer;
  const created = await pix.createPixCharge({
    amountCents: BigInt(offer.priceBrlCents),
    expiresInSeconds: 900,
    description: `AWall ${offer.packCredits} credits`,
    externalId: offer.id,
    metadata: { offerId: offer.id },
  });
  if (!created.ok) {
    log({ msg: "pix charge failed", offerId: offer.id, kind: created.error.kind });
    return offer;
  }
  const updated = await attachPixCharge(db, offer.id, {
    pixChargeId: created.value.chargeId,
    pixBrCode: created.value.brCode,
  });
  return updated ?? offer;
}

/**
 * How long after an offer's deadline the poll still asks the provider.
 *
 * The charge itself lives 15 minutes, so nothing new can be paid after that.
 * The window exists for the payment that happened in time and whose webhook was
 * lost, and it bounds how long this public endpoint can call the provider for
 * one dead offer.
 */
export const PIX_LATE_CONFIRM_MS = 24 * 60 * 60 * 1000;

export type PixCredit =
  | { ok: true; credited: boolean; credits: number }
  | { ok: false; status: number; error: string };

/**
 * Confirm a Pix charge with the provider and credit the pack once.
 *
 * The webhook body is not a source of truth: `confirmPaid` asks the provider.
 * The idempotency key is `pix:<chargeId>`, so a duplicate delivery is a no-op.
 *
 * A charge paid near the deadline belongs to an offer the server may already
 * have expired. `grantCredits` only moves a `pending` offer, so the offer is
 * moved separately: the money arrived and the pack is owed either way.
 *
 * @param db - Ledger connection.
 * @param pix - AbacatePay client.
 * @param chargeId - Provider charge id.
 * @returns Whether this call credited, or why it did not.
 */
export async function creditPixCharge(
  db: Database,
  pix: AbacatePayClient,
  chargeId: string,
): Promise<PixCredit> {
  const confirmed = await confirmPaid(pix, chargeId);
  if (!confirmed.ok) {
    log({ msg: "pix confirm failed", chargeId, kind: confirmed.error.kind });
    return { ok: false, status: 503, error: "pix_provider_unavailable" };
  }
  if (!confirmed.value.paid) {
    if (
      confirmed.value.status === "EXPIRED" ||
      confirmed.value.status === "CANCELLED" ||
      confirmed.value.status === "FAILED"
    ) {
      const offer = await findOfferByPixCharge(db, chargeId);
      if (offer && offer.status === "pending") await closeOffer(db, offer.id, "expired");
    }
    return { ok: false, status: 202, error: confirmed.value.status };
  }

  const offer = await findOfferByPixCharge(db, chargeId);
  if (!offer) return { ok: false, status: 404, error: "offer_not_found" };
  const granted = await grantCredits(db, {
    identityId: offer.identityId,
    offerId: offer.id,
    credits: offer.packCredits,
    payment: {
      rail: "pix",
      amount: String(offer.priceBrlCents),
      asset: "BRL",
      network: "pix:bcb",
      idempotencyKey: `pix:${chargeId}`,
      payer: null,
      settleResponse: { chargeId, status: confirmed.value.status },
      status: "settled",
    },
  });
  if (offer.status !== "paid") await markOfferPaidLate(db, offer.id);
  return { ok: true, credited: granted.credited, credits: offer.packCredits };
}

/**
 * Authenticate an AbacatePay webhook and credit when the provider says paid.
 *
 * @param db - Ledger connection.
 * @param pix - AbacatePay client.
 * @param config - Webhook secret lives here.
 * @param rawBody - Raw request body, before JSON parsing, so the signature matches.
 * @param headers - Request headers.
 * @param url - Request URL, which may carry `webhookSecret`.
 * @returns The HTTP status and body to send back.
 */
export async function handlePixWebhook(
  db: Database,
  pix: AbacatePayClient | null,
  config: GatewayConfig,
  rawBody: string,
  headers: Headers,
  url: URL,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!config.abacatePayWebhookSecret) {
    return { status: 401, body: { error: "webhook_secret_not_configured" } };
  }
  const verified = verifyWebhook(rawBody, [headers, url], config.abacatePayWebhookSecret);
  if (!verified.ok) return { status: 401, body: { error: verified.error.kind } };
  if (!pix) return { status: 503, body: { error: "pix_provider_unavailable" } };
  const chargeId = verified.value.chargeId;
  if (!chargeId) return { status: 202, body: { status: "ignored" } };
  const result = await creditPixCharge(db, pix, chargeId);
  if (!result.ok) return { status: result.status, body: { error: result.error } };
  return { status: 200, body: { status: "paid", credited: result.credited, creditedCredits: result.credits } };
}

/**
 * Public offer status. When a Pix charge has not been credited yet, ask the
 * provider so an agent polling `statusUrl` resumes even if the webhook never
 * arrived. An expired offer is asked about too: this poll is the only fallback
 * when the webhook is lost, and a payment made before the deadline can be
 * confirmed after it.
 *
 * @param db - Ledger connection.
 * @param pix - AbacatePay client, or null.
 * @param id - Offer id.
 * @param now - Clock override, milliseconds.
 * @returns Status code and body. Never includes the identity.
 */
export async function offerStatus(
  db: Database,
  pix: AbacatePayClient | null,
  id: string,
  now: number = Date.now(),
): Promise<{ status: number; body: Record<string, unknown> }> {
  let offer = await getOffer(db, id);
  if (!offer) return { status: 404, body: { error: "offer_not_found" } };

  const expired = offer.status === "expired";
  const withinGrace = now - offer.expiresAt.getTime() < PIX_LATE_CONFIRM_MS;
  if (
    (offer.status === "pending" || (expired && withinGrace)) &&
    offer.pixChargeId &&
    pix &&
    !offer.pixChargeId.startsWith("local_")
  ) {
    const result = await creditPixCharge(db, pix, offer.pixChargeId);
    if (result.ok) {
      offer = (await getOffer(db, id)) ?? offer;
    }
  }

  if (!offer) return { status: 404, body: { error: "offer_not_found" } };
  if (offer.status === "paid") {
    return { status: 200, body: { status: "paid", creditedCredits: offer.packCredits } };
  }
  if (offer.status === "expired" || offer.status === "canceled") {
    return { status: 410, body: { status: offer.status } };
  }
  return {
    status: 202,
    body: {
      status: "pending",
      ...(offer.pixBrCode ? { brCode: offer.pixBrCode } : {}),
      amountCents: offer.priceBrlCents,
      stellar: {
        network: offer.network,
        payTo: offer.payTo,
        usdc: { asset: offer.asset, amount: offer.priceUsdcAtomic, code: "USDC" },
        xlm: { asset: offer.xlmAsset, amount: offer.priceXlmAtomic, code: "XLM" },
      },
      packCredits: offer.packCredits,
      expiresAt: offer.expiresAt.toISOString(),
    },
  };
}
