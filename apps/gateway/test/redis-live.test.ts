import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Redis } from "ioredis";
import type { BucketLimits } from "@awall/policy";
import { SharedQuota } from "../src/quota.js";
import { RedisBucketBackend } from "../src/redis.js";

/**
 * Integration test against a real Redis.
 *
 * The in-process backend proves the algorithm; this proves the deployment. It
 * runs only when `REDIS_TEST_URL` points at a reachable Redis, so the default
 * `pnpm test` stays hermetic. `scripts/redis-replicas.sh` starts one in Docker
 * and sets the variable.
 */
const url = process.env["REDIS_TEST_URL"] ?? "";

/** Free quota of the scope under test. No refill, so the cap is the whole story. */
const limits: BucketLimits = { capacity: 100, refillPerSecond: 0 };

/** Lease size both replicas use. Small, so the interleaving is visible. */
const lease = 8;

describe.skipIf(!url)("two replicas against one Redis", () => {
  let redis: Redis;
  let key: string;

  beforeAll(async () => {
    redis = new Redis(url, { maxRetriesPerRequest: 1, enableReadyCheck: false });
    key = `test-${Date.now()}-${Math.random().toString(36).slice(2)}|shared`;
    await redis.del(`awall:bucket:${key}`);
  });

  afterAll(async () => {
    await redis.del(`awall:bucket:${key}`);
    await redis.quit();
  });

  it("grants the quota once, not once per replica", async () => {
    // Two gateway processes, two clients, one pool. Each replica keeps its own
    // local lease, exactly as a deployed replica does.
    const replicas = [
      new SharedQuota(new RedisBucketBackend(url), { lease, cacheMs: 5 }),
      new SharedQuota(new RedisBucketBackend(url), { lease, cacheMs: 5 }),
    ];

    let granted = 0;
    // Alternate between replicas like a round-robin balancer, past the point
    // where a single pool is exhausted, so a double grant would show up.
    for (let attempt = 0; attempt < limits.capacity * 2 + 4 * lease; attempt += 1) {
      const replica = replicas[attempt % replicas.length];
      if (replica && (await replica.take(key, limits, 1))) granted += 1;
    }

    expect(granted).toBeLessThanOrEqual(limits.capacity);
    // Two single-process buckets would have granted 200 here.
    expect(granted).toBeLessThan(limits.capacity * 2);
    // Nothing but a stranded lease may be lost, and a lease is bounded.
    expect(granted).toBeGreaterThanOrEqual(limits.capacity - replicas.length * lease);
  });

  it("leaves the pool key with a lifetime", async () => {
    const quota = new SharedQuota(new RedisBucketBackend(url), { lease, cacheMs: 5 });
    const live = `${key}-ttl`;
    await quota.take(live, { capacity: 60, refillPerSecond: 1 }, 1);

    const ttl = await redis.pttl(`awall:bucket:${live}`);
    // -1 is a key with no expiry, -2 a key that does not exist.
    expect(ttl).toBeGreaterThan(0);
    await redis.del(`awall:bucket:${live}`);
  });
});
