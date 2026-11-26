import { BucketStore, SharedBucketStore, type BucketBackend, type BucketLimits } from "@awall/policy";

/** Free-quota bucket the gateway spends before it touches the credit ledger. */
export type Quota = {
  take(key: string, limits: BucketLimits, credits: number, now?: number): Promise<boolean>;
  refund(key: string, limits: BucketLimits, credits: number, now?: number): Promise<void>;
  remaining(key: string, limits: BucketLimits, now?: number): Promise<number>;
};

/** The single-process bucket. Two replicas of this each grant the full quota. */
export class MemoryQuota implements Quota {
  private readonly store = new BucketStore();

  async take(key: string, limits: BucketLimits, credits: number, now?: number): Promise<boolean> {
    return this.store.get(key, limits).take(credits, now);
  }

  async refund(key: string, limits: BucketLimits, credits: number, now?: number): Promise<void> {
    this.store.get(key, limits).refund(credits, now);
  }

  async remaining(key: string, limits: BucketLimits, now?: number): Promise<number> {
    return this.store.get(key, limits).remaining(now);
  }
}

/**
 * Bucket shared by every replica.
 *
 * Takes inside `cacheMs` spend a lease already removed from the pool, so the
 * fast path does not round-trip and a second replica cannot spend it too.
 */
export class SharedQuota implements Quota {
  private readonly store: SharedBucketStore;

  constructor(backend: BucketBackend, options?: { lease: number; cacheMs: number }) {
    this.store = new SharedBucketStore(backend, options);
  }

  take(key: string, limits: BucketLimits, credits: number, now?: number): Promise<boolean> {
    return this.store.take(key, limits, credits, now);
  }

  refund(key: string, limits: BucketLimits, credits: number, now?: number): Promise<void> {
    return this.store.refund(key, limits, credits, now);
  }

  remaining(key: string, limits: BucketLimits): Promise<number> {
    return Promise.resolve(this.store.remaining(key));
  }
}
