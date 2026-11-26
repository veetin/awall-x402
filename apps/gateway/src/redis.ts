import { Redis } from "ioredis";
import { CYCLE_POOL_LUA, type BucketBackend, type BucketLimits } from "@awall/policy";

/**
 * Redis backend for the shared free-quota bucket.
 *
 * `CYCLE_POOL_LUA` is one script: commit, release, refill and lease happen in
 * a single `EVAL`, so two replicas cannot each grant the full quota.
 */
export class RedisBucketBackend implements BucketBackend {
  private readonly redis: Redis;

  constructor(url: string) {
    this.redis = new Redis(url, { maxRetriesPerRequest: 1, enableReadyCheck: false });
  }

  async cycle(
    key: string,
    limits: BucketLimits,
    commit: number,
    release: number,
    lease: number,
    now: number,
  ): Promise<number> {
    const granted = await this.redis.eval(
      CYCLE_POOL_LUA,
      1,
      `awall:bucket:${key}`,
      String(commit),
      String(release),
      String(lease),
      String(now),
      String(limits.capacity),
      String(limits.refillPerSecond),
    );
    return Number(granted);
  }

  async release(key: string, limits: BucketLimits, amount: number, now: number): Promise<void> {
    await this.cycle(key, limits, 0, amount, 0, now);
  }
}
