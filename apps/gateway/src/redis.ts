import { Redis } from "ioredis";
import {
  CYCLE_POOL_LUA,
  poolTtlSeconds,
  type BucketBackend,
  type BucketLimits,
} from "@awall/policy";

/** The part of an `ioredis` client this backend uses. */
export type BucketRedis = {
  eval(script: string, numKeys: number, ...args: string[]): Promise<unknown>;
};

/**
 * Redis backend for the shared free-quota bucket.
 *
 * `CYCLE_POOL_LUA` is one script: commit, release, refill, lease and the key's
 * expiry happen in a single `EVAL`, so two replicas cannot each grant the full
 * quota and no path can store a pool without a lifetime.
 *
 * The lifetime comes from `poolTtlSeconds`, derived from the refill window of
 * the scope, so an identity that is still active never loses state it needs,
 * and an identity that stops sending traffic leaves nothing behind.
 */
export class RedisBucketBackend implements BucketBackend {
  private readonly redis: BucketRedis;

  constructor(connection: string | BucketRedis) {
    this.redis =
      typeof connection === "string"
        ? new Redis(connection, { maxRetriesPerRequest: 1, enableReadyCheck: false })
        : connection;
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
      String(poolTtlSeconds(limits) * 1000),
    );
    return Number(granted);
  }

  async release(key: string, limits: BucketLimits, amount: number, now: number): Promise<void> {
    await this.cycle(key, limits, 0, amount, 0, now);
  }
}
