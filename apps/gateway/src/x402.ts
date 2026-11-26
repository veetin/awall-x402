import type { Offer } from "@awall/ledger";
import { buildPixRequirements, type PixPaymentRequirements } from "@awall/pix";
import {
  encodeHeader,
  type PaymentRequired,
  type PaymentRequirements,
} from "@awall/settlement";
import type { GatewayConfig } from "./config.js";

/** Advertised window for an exact Stellar authorization. */
export const EXACT_TIMEOUT_SECONDS = 60;

export type StellarAssetKind = "usdc" | "xlm";

/**
 * Terms of one `exact` Stellar rail, read from the stored offer.
 *
 * The amount is the offer's, never a figure the client sends back. USDC and
 * XLM share the same offer id so either payment credits the same pack.
 *
 * @param offer - Offer row.
 * @param kind - Which Stellar asset to advertise.
 * @returns One `PaymentRequirements` entry.
 */
export function exactRequirements(offer: Offer, kind: StellarAssetKind = "usdc"): PaymentRequirements {
  const isXlm = kind === "xlm";
  return {
    scheme: "exact",
    network: offer.network as `${string}:${string}`,
    amount: isXlm ? offer.priceXlmAtomic : offer.priceUsdcAtomic,
    asset: isXlm ? offer.xlmAsset : offer.asset,
    payTo: offer.payTo,
    maxTimeoutSeconds: EXACT_TIMEOUT_SECONDS,
    extra: {
      areFeesSponsored: true,
      packCredits: offer.packCredits,
      offerId: offer.id,
      assetCode: isXlm ? "XLM" : "USDC",
    },
  };
}

/**
 * Pick the exact-rail terms that match what the client signed.
 *
 * @param offer - Stored offer.
 * @param acceptedAsset - Asset contract from `PaymentPayload.accepted.asset`.
 * @returns The matching requirements, or `null` when the asset is unknown.
 */
export function exactRequirementsForAsset(
  offer: Offer,
  acceptedAsset: string,
): PaymentRequirements | null {
  if (acceptedAsset === offer.asset) return exactRequirements(offer, "usdc");
  if (acceptedAsset === offer.xlmAsset) return exactRequirements(offer, "xlm");
  return null;
}

/**
 * Terms of the `pix` rail for the same offer.
 *
 * @param offer - Offer row. A missing charge id falls back to a local id so the
 *   rail is still advertised when the provider is not configured.
 * @param config - Public URLs of the checkout and the gateway.
 * @param prefix - Control-plane prefix, usually `/awall`.
 * @returns The requirements object from `@awall/pix`.
 */
export function pixRequirements(
  offer: Offer,
  config: GatewayConfig,
  prefix: string,
): PixPaymentRequirements {
  return buildPixRequirements({
    amountCents: BigInt(offer.priceBrlCents),
    chargeId: offer.pixChargeId ?? `local_${offer.id}`,
    checkoutUrl: `${config.checkoutBaseUrl}/pay/${offer.id}`,
    statusUrl: `${config.publicBaseUrl}${prefix}/offers/${offer.id}`,
    ...(offer.pixBrCode ? { brCode: offer.pixBrCode } : {}),
    expiresAt: offer.expiresAt,
    maxTimeoutSeconds: 900,
  });
}

/**
 * Build the `PaymentRequired` object for a request that ran out of quota.
 *
 * @param requestUrl - Full URL of the request that was refused.
 * @param offer - The offer being charged for.
 * @param config - Gateway configuration.
 * @param prefix - Control-plane prefix.
 * @returns The object to encode into the `PAYMENT-REQUIRED` header and the body.
 */
export function buildPaymentRequired(
  requestUrl: string,
  offer: Offer,
  config: GatewayConfig,
  prefix: string,
): PaymentRequired {
  return {
    x402Version: 2,
    error: "Free quota exhausted. Pay to continue.",
    resource: {
      url: requestUrl,
      description: `Credit pack of ${offer.packCredits} credits`,
      mimeType: "application/json",
      serviceName: "AWall",
    },
    accepts: [
      exactRequirements(offer, "usdc"),
      exactRequirements(offer, "xlm"),
      pixRequirements(offer, config, prefix),
    ] as PaymentRequired["accepts"],
    extensions: {},
  };
}

export { encodeHeader };
