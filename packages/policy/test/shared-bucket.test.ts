import { describe, expect, it } from "vitest";
import {
  CYCLE_POOL_LUA,
  InProcessBucketBackend,
  POOL_TTL_MAX_SECONDS,
  POOL_TTL_MIN_SECONDS,
  POOL_TTL_WINDOWS,
  SharedBucketStore,
  cyclePool,
  fullPool,
  poolTtlSeconds,
  releasePool,
} from "../src/shared-bucket.js";

const limits = { capacity: 10, refillPerSecond: 0 };
const now = 1_700_000_000_000;

describe("shared bucket", () => {
  it("does not double the quota across two replicas", async () => {
    const backend = new InProcessBucketBackend();
    const left = new SharedBucketStore(backend, { lease: 1, cacheMs: 0 });
    const right = new SharedBucketStore(backend, { lease: 1, cacheMs: 0 });
    const results = await Promise.all(
      Array.from({ length: 40 }, (_, index) =>
        (index % 2 === 0 ? left : right).take("identity|shared", limits, 1, now),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(limits.capacity);
  });

  it("serves a burst from the local lease without a second pool read", async () => {
    const backend = new InProcessBucketBackend();
    let cycles = 0;
    const counting = {
      cycle: (...args: Parameters<InProcessBucketBackend["cycle"]>) => {
        cycles += 1;
        return backend.cycle(...args);
      },
      release: (...args: Parameters<InProcessBucketBackend["release"]>) => backend.release(...args),
    };
    const store = new SharedBucketStore(counting, { lease: 8, cacheMs: 50 });
    expect(await store.take("k", { capacity: 8, refillPerSecond: 0 }, 1, now)).toBe(true);
    expect(await store.take("k", { capacity: 8, refillPerSecond: 0 }, 1, now + 10)).toBe(true);
    expect(cycles).toBe(1);
  });

  it("refunds a failed request back into the same replica's lease", async () => {
    const store = new SharedBucketStore(new InProcessBucketBackend(), { lease: 4, cacheMs: 1_000 });
    const tight = { capacity: 4, refillPerSecond: 0 };
    expect(await store.take("k", tight, 2, now)).toBe(true);
    await store.refund("k", tight, 2, now);
    expect(await store.take("k", tight, 4, now + 1)).toBe(true);
    expect(await store.take("k", tight, 1, now + 2)).toBe(false);
  });
});

describe("shared pool lifetime", () => {
  it("derives the lifetime from the refill window of the scope", () => {
    const window = { capacity: 600, refillPerSecond: 1 };
    expect(poolTtlSeconds(window)).toBe(600 * POOL_TTL_WINDOWS);
  });

  it("clamps a very short window up and a never-refilling one down", () => {
    expect(poolTtlSeconds({ capacity: 1, refillPerSecond: 10 })).toBe(POOL_TTL_MIN_SECONDS);
    expect(poolTtlSeconds({ capacity: 10, refillPerSecond: 0 })).toBe(POOL_TTL_MAX_SECONDS);
    expect(poolTtlSeconds({ capacity: 10, refillPerSecond: 1e-9 })).toBe(POOL_TTL_MAX_SECONDS);
  });

  it("sets the expiry in the same call that spends", () => {
    const ttl = poolTtlSeconds(limits);
    const pool = fullPool(limits.capacity, now, ttl);
    const granted = cyclePool(pool, limits, 0, 0, 4, now + 1_000);
    expect(granted).toBe(4);
    expect(pool.outstanding).toBe(4);
    expect(pool.expiresAt).toBe(now + 1_000 + ttl * 1000);
  });

  it("sets the expiry when it only returns credits", () => {
    const ttl = poolTtlSeconds(limits);
    const pool = fullPool(limits.capacity, now, ttl);
    cyclePool(pool, limits, 0, 0, 4, now);
    releasePool(pool, limits, 1, now + 2_000);
    expect(pool.expiresAt).toBe(now + 2_000 + ttl * 1000);
  });

  it("gives every key the backend writes an expiry, in that same operation", async () => {
    const backend = new InProcessBucketBackend();
    const store = new SharedBucketStore(backend, { lease: 4, cacheMs: 0 });
    const scopes = [
      { key: "identity|shared", limits: { capacity: 600, refillPerSecond: 1 } },
      { key: "identity|GET /v1/reports/*", limits: { capacity: 60, refillPerSecond: 0.5 } },
    ];
    for (const scope of scopes) {
      expect(await store.take(scope.key, scope.limits, 1, now)).toBe(true);
      const pool = backend.inspect(scope.key, now);
      expect(pool).toBeDefined();
      expect(pool?.expiresAt).toBe(now + poolTtlSeconds(scope.limits) * 1000);
    }
  });

  it("writes the expiry inside the same Lua script as the spend", () => {
    const writes = CYCLE_POOL_LUA.match(/redis\.call\('HSET'/g) ?? [];
    const expiries = CYCLE_POOL_LUA.match(/redis\.call\('PEXPIRE', key, ttl\)/g) ?? [];
    expect(writes).toHaveLength(1);
    expect(expiries).toHaveLength(writes.length);
    expect(CYCLE_POOL_LUA.indexOf("PEXPIRE")).toBeGreaterThan(CYCLE_POOL_LUA.indexOf("HSET"));
    expect(CYCLE_POOL_LUA).toContain("local ttl = tonumber(ARGV[7])");
  });

  it("rebuilds a pool whose key expired while the identity was quiet", async () => {
    const backend = new InProcessBucketBackend();
    const store = new SharedBucketStore(backend, { lease: 10, cacheMs: 0 });
    const tight = { capacity: 10, refillPerSecond: 0 };
    expect(await store.take("gone", tight, 10, now)).toBe(true);
    expect(await store.take("gone", tight, 1, now + 1)).toBe(false);
    const afterTtl = now + poolTtlSeconds(tight) * 1000 + 1;
    expect(backend.inspect("gone", afterTtl)).toBeUndefined();
    expect(await store.take("gone", tight, 10, afterTtl)).toBe(true);
  });

  it("drops a key that is back to the fresh state instead of refreshing it", async () => {
    const backend = new InProcessBucketBackend();
    const tight = { capacity: 4, refillPerSecond: 0 };
    backend.cycle("idle", tight, 0, 0, 4, now);
    expect(backend.inspect("idle", now)).toBeDefined();
    let last = now;
    for (let touch = 1; touch <= 3; touch += 1) {
      last = now + touch * 1_000;
      backend.release("idle", tight, touch === 1 ? 4 : 1, last);
    }
    expect(backend.inspect("idle", last)).toBeUndefined();
  });
});
