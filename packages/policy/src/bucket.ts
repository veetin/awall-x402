/**
 * Token bucket over credits, refilled continuously.
 *
 * In-memory on purpose: the MVP gateway is single-instance. Horizontal scale
 * needs this state in Redis. See docs/02-arquitetura.md.
 */
export class TokenBucket {
  private tokens: number;
  private updatedAt: number;

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    now: number = Date.now(),
  ) {
    this.tokens = capacity;
    this.updatedAt = now;
  }

  private refill(now: number): void {
    const elapsed = (now - this.updatedAt) / 1000;
    if (elapsed <= 0) return;
    this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
    this.updatedAt = now;
  }

  /** Remaining credits, floored. */
  remaining(now: number = Date.now()): number {
    this.refill(now);
    return Math.floor(this.tokens);
  }

  /**
   * Try to spend credits.
   *
   * @param credits - Units to spend.
   * @param now - Current time in milliseconds.
   * @returns true when the units were available and spent.
   */
  take(credits: number, now: number = Date.now()): boolean {
    this.refill(now);
    if (this.tokens < credits) return false;
    this.tokens -= credits;
    return true;
  }

  /** Give units back, capped at capacity. Used when the origin fails. */
  refund(credits: number, now: number = Date.now()): void {
    this.refill(now);
    this.tokens = Math.min(this.capacity, this.tokens + credits);
  }
}

export type BucketLimits = { capacity: number; refillPerSecond: number };

/**
 * One bucket per key.
 *
 * The key is the identity plus a scope, so a route with a quota of its own gets
 * a separate bucket from the shared one. Limits come from the caller, because
 * they are a property of the scope and not of the store.
 */
export class BucketStore {
  private readonly buckets = new Map<string, TokenBucket>();

  /**
   * Get the bucket for a key, creating it on first use.
   *
   * @param key - Identity plus scope, e.g. `idt_123|GET /v1/reports/*`.
   * @param limits - Capacity and refill rate for this scope.
   * @returns The bucket.
   */
  get(key: string, limits: BucketLimits): TokenBucket {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new TokenBucket(limits.capacity, limits.refillPerSecond);
      this.buckets.set(key, bucket);
    }
    return bucket;
  }
}

/**
 * Translate a quota window into bucket limits.
 *
 * @param tier - Quota window from the policy.
 * @returns Capacity, including burst headroom, and refill rate per second.
 */
export function limitsFor(tier: {
  credits: number;
  burst: number;
  window_seconds: number;
}): BucketLimits {
  return {
    capacity: tier.credits + tier.burst,
    refillPerSecond: tier.credits / tier.window_seconds,
  };
}
