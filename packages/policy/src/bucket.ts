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

/** One bucket per identity. */
export class BucketStore {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  get(identityId: string): TokenBucket {
    let bucket = this.buckets.get(identityId);
    if (!bucket) {
      bucket = new TokenBucket(this.capacity, this.refillPerSecond);
      this.buckets.set(identityId, bucket);
    }
    return bucket;
  }
}
