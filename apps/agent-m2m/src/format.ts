/**
 * Formatting helpers for the demo output.
 *
 * Money never goes through `number`: atomic amounts are integer strings and are
 * formatted by splitting the digits, so a 7-decimal USDC amount keeps every
 * digit. See the hard rules in AGENTS.md.
 */

/** Stellar USDC has 7 decimals, not the 6 of EVM USDC. */
export const STELLAR_USDC_DECIMALS = 7;

/**
 * Format an atomic integer amount as a decimal string.
 *
 * @param atomic - Amount in atomic units, as an integer string.
 * @param decimals - Decimal places of the asset.
 * @returns The decimal representation, e.g. `"0.6800000"` for `"6800000"`.
 */
export function formatAtomic(atomic: string, decimals: number): string {
  if (!/^-?\d+$/.test(atomic)) throw new Error(`Not an integer amount: ${atomic}`);
  const negative = atomic.startsWith("-");
  const digits = (negative ? atomic.slice(1) : atomic).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = decimals === 0 ? "" : `.${digits.slice(digits.length - decimals)}`;
  return `${negative ? "-" : ""}${whole}${fraction}`;
}

/**
 * Format an amount in BRL cents as Brazilian currency.
 *
 * @param cents - Amount in cents, as an integer string.
 * @returns A string like `"R$ 3,94"`.
 */
export function formatBrlCents(cents: string): string {
  return `R$ ${formatAtomic(cents, 2).replace(".", ",")}`;
}

/**
 * Build the stellar.expert link for a settled transaction.
 *
 * @param network - CAIP-2 network, e.g. `"stellar:testnet"`.
 * @param txHash - Transaction hash in hex.
 * @returns The explorer URL.
 */
export function explorerTxUrl(network: string, txHash: string): string {
  const name = network === "stellar:pubnet" ? "public" : "testnet";
  return `https://stellar.expert/explorer/${name}/tx/${txHash}`;
}

/**
 * Shorten an address or hash for a log line.
 *
 * @param value - Value to shorten.
 * @param keep - Characters to keep at each end.
 * @returns The shortened value, or the original when it is already short.
 */
export function shorten(value: string, keep = 6): string {
  if (value.length <= keep * 2 + 1) return value;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
