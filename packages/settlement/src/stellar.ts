/**
 * Helpers for the `exact` scheme on Stellar.
 *
 * Stellar has exactly one scheme in x402: `exact`. `upto` and `auth-capture`
 * are EVM (and, for `upto`, SVM) bindings, so a Stellar requirement that names
 * anything but `exact` is malformed, not an unimplemented feature.
 */

import type { Network, PaymentRequirements, SupportedKind, SupportedResponse } from "./types.js";
import { X402_VERSION } from "./types.js";

/** CAIP-2 namespace of every Stellar network. */
export const STELLAR_NAMESPACE = "stellar";

/** The only scheme with a Stellar binding. */
export const STELLAR_SCHEME = "exact";

/**
 * Decimals of USDC on Stellar. **Seven**, not the six of EVM USDC: 0.50 USDC is
 * `"5000000"`. Copying an EVM example here misprices by 10x.
 */
export const STELLAR_USDC_DECIMALS = 7;

/**
 * Whether a requirement is the `exact` scheme on a Stellar network.
 *
 * @param requirements - One entry of the `accepts` array.
 * @returns True for `scheme: "exact"` on any `stellar:*` network.
 */
export function isStellarExact(requirements: PaymentRequirements): boolean {
  return requirements.scheme === STELLAR_SCHEME && isStellarNetwork(requirements.network);
}

/**
 * Whether a CAIP-2 identifier names a Stellar network.
 *
 * @param network - CAIP-2 identifier, for example `stellar:testnet`.
 * @returns True when the namespace is `stellar`.
 */
export function isStellarNetwork(network: string): boolean {
  return network.startsWith(`${STELLAR_NAMESPACE}:`);
}

/**
 * Whether a Stellar requirement declares facilitator-sponsored fees.
 *
 * `extra.areFeesSponsored: true` is mandatory in the Stellar binding: the client
 * signs auth entries only, and the facilitator pays the transaction fee. A
 * requirement without it cannot be paid by a client following the binding.
 *
 * @param requirements - One entry of the `accepts` array.
 * @returns True when `extra.areFeesSponsored` is exactly `true`.
 */
export function hasSponsoredFees(requirements: PaymentRequirements): boolean {
  return requirements.extra["areFeesSponsored"] === true;
}

/** Why a facilitator cannot serve the configured pair. */
export type UnsupportedPairReason =
  /** The facilitator advertises the network but not with this scheme. */
  | "scheme_not_supported"
  /** The facilitator advertises nothing on this network. */
  | "network_not_supported"
  /** The pair is advertised, but only for another protocol version. */
  | "x402_version_not_supported";

/** Whether the facilitator serves the configured `(scheme, network)` pair. */
export type SupportCheck =
  | { supported: true; kind: SupportedKind }
  | { supported: false; reason: UnsupportedPairReason };

/**
 * Confirm, from a `/supported` response, that the facilitator serves the pair
 * the gateway is configured for.
 *
 * Run this at startup. The failure it catches — a facilitator that does not
 * speak `exact` on `stellar:testnet` — otherwise shows up as a rejected
 * `/verify` on the first real payment.
 *
 * @param supported - The `/supported` response.
 * @param scheme - Configured scheme, for example `exact`.
 * @param network - Configured CAIP-2 network, for example `stellar:testnet`.
 * @returns The matching kind, or why there is no match.
 */
export function checkFacilitatorSupport(
  supported: SupportedResponse,
  scheme: string,
  network: Network,
): SupportCheck {
  const onNetwork = supported.kinds.filter((kind) => kind.network === network);
  if (onNetwork.length === 0) {
    return { supported: false, reason: "network_not_supported" };
  }
  const withScheme = onNetwork.filter((kind) => kind.scheme === scheme);
  if (withScheme.length === 0) {
    return { supported: false, reason: "scheme_not_supported" };
  }
  const match = withScheme.find((kind) => kind.x402Version === X402_VERSION);
  if (match === undefined) {
    return { supported: false, reason: "x402_version_not_supported" };
  }
  return { supported: true, kind: match };
}

/**
 * Confirm the facilitator serves `exact` on a Stellar network.
 *
 * @param supported - The `/supported` response.
 * @param network - Configured Stellar network, for example `stellar:testnet`.
 * @returns The matching kind, or why there is no match.
 */
export function checkStellarExactSupport(
  supported: SupportedResponse,
  network: Network,
): SupportCheck {
  return checkFacilitatorSupport(supported, STELLAR_SCHEME, network);
}
