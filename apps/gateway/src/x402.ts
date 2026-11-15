import type { Offer } from "./offers.js";
import type { GatewayConfig } from "./config.js";

/** x402 v2 `PaymentRequirements`. */
export type PaymentRequirements = {
  scheme: string;
  network: string;
  amount: string;
  asset: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown>;
};

/** x402 v2 `PaymentRequired`. */
export type PaymentRequired = {
  x402Version: 2;
  error?: string;
  resource: {
    url: string;
    description?: string;
    mimeType?: string;
    serviceName?: string;
  };
  accepts: PaymentRequirements[];
  extensions: Record<string, unknown>;
};

/**
 * Build the two payment rails advertised for an offer.
 *
 * The `exact` rail settles USDC on Stellar; `extra.areFeesSponsored` is required
 * by the Stellar binding. The `pix` rail is the scheme specified in
 * specs/scheme_pix.md, for agents with a human in the loop.
 *
 * @param offer - The offer being charged for.
 * @param config - Gateway configuration.
 * @returns The `accepts` array, `exact` first.
 */
export function buildAccepts(offer: Offer, config: GatewayConfig): PaymentRequirements[] {
  return [
    {
      scheme: "exact",
      network: config.network,
      amount: offer.usdcAtomic,
      asset: config.asset,
      payTo: config.payTo,
      maxTimeoutSeconds: 60,
      extra: {
        areFeesSponsored: true,
        packCredits: offer.packCredits,
        offerId: offer.id,
      },
    },
    {
      scheme: "pix",
      network: "pix:bcb",
      amount: String(offer.brlCents),
      asset: "BRL",
      payTo: "merchant",
      maxTimeoutSeconds: 900,
      extra: {
        checkoutUrl: `${config.checkoutBaseUrl}/pay/${offer.id}`,
        statusUrl: `${config.publicBaseUrl}/awall/offers/${offer.id}`,
        packCredits: offer.packCredits,
        offerId: offer.id,
      },
    },
  ];
}

/**
 * Build the `PaymentRequired` object for a request that ran out of quota.
 *
 * @param requestUrl - Full URL of the request that was refused.
 * @param offer - The offer being charged for.
 * @param config - Gateway configuration.
 * @returns The object to encode into the `PAYMENT-REQUIRED` header.
 */
export function buildPaymentRequired(
  requestUrl: string,
  offer: Offer,
  config: GatewayConfig,
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
    accepts: buildAccepts(offer, config),
    extensions: {},
  };
}

/** Encode an x402 object for a header. */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/** Decode an x402 header back into an object. */
export function decodeHeader<T>(value: string): T {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8")) as T;
}
