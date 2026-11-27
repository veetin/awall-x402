/** Stellar assets use 7 decimals (never 6 like EVM). */
export const STELLAR_DECIMALS = 7;

export const BASE_PACK = {
  packCredits: 10_000,
  baseUsdcAtomic: 5_000_000n, // "0.50" USDC in 7-decimal atomic units
  baseXlmAtomic: 50_000_000n, // "5.00" XLM in 7-decimal atomic units
  baseBrlCents: 290n, // R$ 2.90 in centavos
  maxMultiplier: 3,
} as const;

export type SignalInputs = {
  burst: number;
  identical: number;
  errors: number;
  cache: number;
};

export type PackQuote = {
  score: number;
  multiplier: number;
  usdcAtomic: string;
  xlmAtomic: string;
  brlCents: number;
  packCredits: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function applyMultiplier(base: bigint, multiplier: number): bigint {
  const basisPoints = BigInt(Math.round(multiplier * 10_000));
  return (base * basisPoints + 5_000n) / 10_000n;
}

/**
 * Compute the pack quote using the same integer basis-point formula as
 * `@awall/policy`: score = mean of 4 signals, multiplier = 1 + (max - 1) * score.
 */
export function computePackQuote(
  signals: SignalInputs,
  maxMultiplier: number = BASE_PACK.maxMultiplier,
): PackQuote {
  const score = clamp01(
    (clamp01(signals.burst) +
      clamp01(signals.identical) +
      clamp01(signals.errors) +
      clamp01(signals.cache)) /
      4,
  );
  const multiplier = 1 + (maxMultiplier - 1) * score;

  return {
    score,
    multiplier,
    usdcAtomic: applyMultiplier(BASE_PACK.baseUsdcAtomic, multiplier).toString(),
    xlmAtomic: applyMultiplier(BASE_PACK.baseXlmAtomic, multiplier).toString(),
    brlCents: Number(applyMultiplier(BASE_PACK.baseBrlCents, multiplier)),
    packCredits: BASE_PACK.packCredits,
  };
}

/** Format a 7-decimal Stellar atomic integer string to a fixed display string. */
export function formatStellarDisplay(atomic: string, decimals = 2): string {
  const value = BigInt(atomic);
  const factor = 10n ** BigInt(STELLAR_DECIMALS);
  const whole = value / factor;
  const frac = (value % factor).toString().padStart(STELLAR_DECIMALS, "0");
  return `${whole}.${frac.slice(0, decimals)}`;
}

/** Format integer centavos as `R$ X.XX` or `R$ X,XX`. */
export function formatBrlDisplay(cents: number, decimalSeparator: "," | "." = ","): string {
  const whole = Math.floor(cents / 100);
  const rem = (cents % 100).toString().padStart(2, "0");
  return `R$ ${whole}${decimalSeparator}${rem}`;
}
