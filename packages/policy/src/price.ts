import type { Policy } from "./types.js";

/** Stellar assets use 7 decimals. USDC on EVM uses 6: do not copy EVM examples. */
export const USDC_DECIMALS = 7;

/**
 * Convert a decimal amount to atomic units.
 *
 * @param value - Decimal string, e.g. `"0.50"`. At most `decimals` fraction digits.
 * @param decimals - Number of decimals of the asset.
 * @returns Atomic units.
 * @throws If the string is not a plain decimal or has too many fraction digits.
 */
export function decimalToAtomic(value: string, decimals: number = USDC_DECIMALS): bigint {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) throw new Error(`not a decimal amount: ${value}`);
  const whole = match[1] ?? "0";
  const fraction = match[2] ?? "";
  if (fraction.length > decimals) {
    throw new Error(`${value} has more than ${decimals} decimals`);
  }
  return BigInt(whole + fraction.padEnd(decimals, "0"));
}

/**
 * Price multiplier derived from an abuse score.
 *
 * @param score - Abuse score in [0, 1]. Values outside the range are clamped.
 * @param maxMultiplier - Ceiling from the policy.
 * @returns Multiplier in [1, maxMultiplier].
 */
export function abuseMultiplier(score: number, maxMultiplier: number): number {
  const clamped = Math.min(1, Math.max(0, Number.isFinite(score) ? score : 0));
  return 1 + (maxMultiplier - 1) * clamped;
}

/** Multiply an integer by a multiplier, in basis points, rounding half up. */
function applyMultiplier(base: bigint, multiplier: number): bigint {
  const basisPoints = BigInt(Math.round(multiplier * 10_000));
  return (base * basisPoints + 5_000n) / 10_000n;
}

export type Price = {
  /** Atomic units of USDC, as a string (7 decimals). */
  usdcAtomic: string;
  /** Atomic units of XLM, as a string (7 decimals). */
  xlmAtomic: string;
  /** BRL in centavos. */
  brlCents: number;
  /** Compute units the payment buys. */
  packCredits: number;
  /** Multiplier applied to the base price. */
  multiplier: number;
};

/**
 * Price one credit pack for an identity.
 *
 * @param policy - Loaded policy.
 * @param abuseScore - Abuse score of the identity, in [0, 1].
 * @returns The price on USDC, XLM and Pix, plus the multiplier used.
 */
export function priceFor(policy: Policy, abuseScore: number): Price {
  const multiplier = abuseMultiplier(abuseScore, policy.pricing.max_multiplier);
  const baseUsdc = decimalToAtomic(policy.pricing.price_usdc);
  const baseXlm = decimalToAtomic(policy.pricing.price_xlm);
  const baseCents = BigInt(policy.pricing.price_brl_cents);
  return {
    usdcAtomic: applyMultiplier(baseUsdc, multiplier).toString(),
    xlmAtomic: applyMultiplier(baseXlm, multiplier).toString(),
    brlCents: Number(applyMultiplier(baseCents, multiplier)),
    packCredits: policy.pricing.pack_credits,
    multiplier,
  };
}
