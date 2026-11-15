import type {
  PaymentRequired,
  PaymentRequirements,
  SchemeNetworkClient,
} from "@x402/fetch";
import { findDefaultAsset } from "@x402/stellar";

/** The testnet USDC contract the gateway advertises. */
export const USDC = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";
/** A valid Ed25519 strkey, standing in for the gateway's `STELLAR_PAY_TO`. */
export const PAY_TO = "GDSAWZDAAYCQNALBDF2G5QQHRMI5LR7P5B2NB7X5GJYAN2H7B2R3OTOX";
/** Stands in for a signed transaction envelope; base64, as the spec requires. */
export const FAKE_XDR = Buffer.from("signed-soroban-envelope").toString("base64");

/**
 * The two rails AWall advertises in one 402, `exact` first.
 *
 * @param amountAtomic - USDC amount in atomic units (7 decimals).
 * @returns The `accepts` array.
 */
export function awallAccepts(amountAtomic = "6800000"): PaymentRequirements[] {
  return [
    {
      scheme: "exact",
      network: "stellar:testnet",
      amount: amountAtomic,
      asset: USDC,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
      extra: { areFeesSponsored: true, packCredits: 10000, offerId: "ofr_test" },
    },
    {
      scheme: "pix",
      network: "pix:bcb",
      amount: "394",
      asset: "BRL",
      payTo: "merchant",
      maxTimeoutSeconds: 900,
      extra: {
        checkoutUrl: "http://localhost:3000/pay/ofr_test",
        statusUrl: "http://localhost:8402/awall/offers/ofr_test",
        packCredits: 10000,
        offerId: "ofr_test",
      },
    },
  ];
}

/**
 * Build the `PaymentRequired` object the gateway puts in the header.
 *
 * @param url - Resource that was refused.
 * @param accepts - Rails to advertise.
 * @returns The object to encode.
 */
export function awallPaymentRequired(
  url: string,
  accepts: PaymentRequirements[] = awallAccepts(),
): PaymentRequired {
  return {
    x402Version: 2,
    error: "Free quota exhausted. Pay to continue.",
    resource: {
      url,
      description: "Credit pack of 10000 credits",
      mimeType: "application/json",
      serviceName: "AWall",
    },
    accepts,
    extensions: {},
  };
}

/**
 * Encode an x402 object the way the headers carry it.
 *
 * @param value - Object to encode.
 * @returns Base64 of its JSON.
 */
export function encodeHeader(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64");
}

/**
 * Decode an x402 header back into an object.
 *
 * @param value - Base64 header value.
 * @returns The parsed object.
 */
export function decodeHeader(value: string): unknown {
  return JSON.parse(Buffer.from(value, "base64").toString("utf8"));
}

/**
 * A scheme client that signs nothing.
 *
 * It keeps the real `x402Client` in the test path — selection, spend controls
 * and payload wrapping all run — while the Soroban RPC and the private key stay
 * out of the suite.
 *
 * @param xdr - Base64 string to return as the signed transaction.
 * @returns The scheme client and the requirements it was asked to sign.
 */
export function fakeExactStellarScheme(xdr = FAKE_XDR): {
  scheme: SchemeNetworkClient;
  signed: PaymentRequirements[];
} {
  const signed: PaymentRequirements[] = [];
  return {
    signed,
    scheme: {
      scheme: "exact",
      findDefaultAsset,
      createPaymentPayload: async (x402Version, paymentRequirements) => {
        signed.push(paymentRequirements);
        return { x402Version, payload: { transaction: xdr } };
      },
    },
  };
}
