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

export type Route = { readonly path: string; readonly credits: number };

/** Routes of awall.yaml that draw from the shared free tier. */
export const ROUTES: readonly Route[] = [
  { path: "GET /v1/search?q=camera", credits: 1 },
  { path: "GET /v1/items/42", credits: 2 },
  { path: "GET /v1/flaky", credits: 5 },
];

export type Rail = "stellar" | "pix";

export type Account = {
  /** Free-tier tokens, in 1/windowSeconds of a credit so the refill stays an integer. */
  bucket: number;
  /** Arrivals not yet whole, in 1/60 of a request. */
  carry: number;
  /** Paid credits left. One balance per identity, whatever rail bought them. */
  balance: number;
  served: { free: number; stellar: number; pix: number };
  packs: { stellar: number; pix: number };
};

export type Slot = { free: number; paid: number };

export type Minute = {
  account: Account;
  /** Requests answered from the free tier this minute. */
  free: number;
  /** Requests paid from the credit balance this minute. */
  paid: number;
  /** Packs bought this minute: each one is a 402 answered and settled. */
  packs: number;
  seconds: Slot[];
};

const UNIT = POLICY.windowSeconds;
const CAPACITY = (POLICY.freeCredits + POLICY.burst) * UNIT;
/** Refill per second, in bucket units: freeCredits / windowSeconds credits. */
const REFILL = POLICY.freeCredits;

/** A new identity: full bucket, no credits, nothing served. */
export function freshAccount(): Account {
  return {
    bucket: CAPACITY,
    carry: 0,
    balance: 0,
    served: { free: 0, stellar: 0, pix: 0 },
    packs: { stellar: 0, pix: 0 },
  };
}

/**
 * One minute of one agent against the policy, second by second.
 *
 * The free tier is the gateway's token bucket: capacity `credits + burst`,
 * refilled at `credits / window_seconds`. Past it, a request spends paid
 * credits, and an empty balance is a 402 that buys one pack on `rail`.
 *
 * @param from - Account at the start of the minute. Not mutated.
 * @param perMinute - Requests per minute.
 * @param credits - Cost of the route.
 * @param rail - Rail that pays the 402s of this minute.
 */
export function runMinute(from: Account, perMinute: number, credits: number, rail: Rail): Minute {
  const account: Account = {
    ...from,
    served: { ...from.served },
    packs: { ...from.packs },
  };
  const cost = credits * UNIT;
  const seconds: Slot[] = [];
  let free = 0;
  let paid = 0;
  let packs = 0;
  for (let second = 0; second < 60; second += 1) {
    account.bucket = Math.min(CAPACITY, account.bucket + REFILL);
    account.carry += perMinute;
    const arrivals = Math.floor(account.carry / 60);
    account.carry -= arrivals * 60;
    const slot: Slot = { free: 0, paid: 0 };
    for (let n = 0; n < arrivals; n += 1) {
      if (account.bucket >= cost) {
        account.bucket -= cost;
        slot.free += 1;
        continue;
      }
      while (account.balance < credits) {
        account.balance += POLICY.packCredits;
        account.packs[rail] += 1;
        packs += 1;
      }
      account.balance -= credits;
      slot.paid += 1;
    }
    free += slot.free;
    paid += slot.paid;
    seconds.push(slot);
  }
  account.served.free += free;
  account.served[rail] += paid;
  return { account, free, paid, packs, seconds };
}

/** Share of this minute's requests on each river: free, Stellar, Pix. */
export function sharesOf(minute: Minute, rail: Rail): [number, number, number] {
  const total = minute.free + minute.paid;
  if (total === 0) return [1, 0, 0];
  const free = minute.free / total;
  const paid = 1 - free;
  return rail === "stellar" ? [free, paid, 0] : [free, 0, paid];
}

export function revenueUsdc(account: Account): bigint {
  return BigInt(account.packs.stellar) * POLICY.priceUsdcAtomic;
}

export function revenueBrl(account: Account): bigint {
  return BigInt(account.packs.pix) * POLICY.priceBrlCents;
}

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
