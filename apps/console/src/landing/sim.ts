/**
 * The default policy in awall.yaml. The landing page is static and public, so
 * it cannot read the operator's live policy from `/awall/policy`; these values
 * have to follow the YAML by hand.
 */
export const POLICY = {
  freeCredits: 100,
  windowSeconds: 60,
  burst: 30,
  packCredits: 10_000,
  /** 0.50 USDC. Stellar assets have 7 decimals, not the 6 of EVM USDC. */
  priceUsdcAtomic: 5_000_000n,
  /** 5.00 XLM, also 7 decimals. */
  priceXlmAtomic: 50_000_000n,
  priceBrlCents: 290n,
  maxMultiplier: 3,
} as const;

/** Same formula as `abuseMultiplier` in packages/policy. */
export function abuseMultiplier(score: number): number {
  const clamped = Math.min(1, Math.max(0, score));
  return 1 + (POLICY.maxMultiplier - 1) * clamped;
}

/** Same rounding as packages/policy: basis points, half up. */
export function applyMultiplier(base: bigint, multiplier: number): bigint {
  const basisPoints = BigInt(Math.round(multiplier * 10_000));
  return (base * basisPoints + 5_000n) / 10_000n;
}

const integer = new Intl.NumberFormat("pt-BR");

export function formatInt(value: number | bigint): string {
  return integer.format(value);
}

/** Atomic units of a 7-decimal Stellar asset, shown with two decimals. */
export function formatStellar(atomic: bigint): string {
  const negative = atomic < 0n;
  const abs = negative ? -atomic : atomic;
  const whole = abs / 10_000_000n;
  const cents = (abs % 10_000_000n) / 100_000n;
  return `${negative ? "-" : ""}${integer.format(whole)},${cents.toString().padStart(2, "0")}`;
}

export function formatBrl(cents: bigint): string {
  const whole = cents / 100n;
  const rest = cents % 100n;
  return `R$ ${integer.format(whole)},${rest.toString().padStart(2, "0")}`;
}
