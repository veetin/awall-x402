import { describe, expect, it } from "vitest";
import { CYCLE_POOL_LUA, poolTtlSeconds, type BucketLimits } from "@awall/policy";
import { RedisBucketBackend, type BucketRedis } from "../src/redis.js";

type Call = { script: string; numKeys: number; args: string[] };

/** Records every command the backend issues, so a test can count them. */
class RecordingRedis implements BucketRedis {
  readonly calls: Call[] = [];

  constructor(private readonly granted: number) {}

  async eval(script: string, numKeys: number, ...args: string[]): Promise<unknown> {
    this.calls.push({ script, numKeys, args });
    return this.granted;
  }
}

const limits: BucketLimits = { capacity: 600, refillPerSecond: 1 };
const now = 1_700_000_000_000;

describe("redis bucket backend", () => {
  it("spends and expires the key in one EVAL, with the lifetime of the scope", async () => {
    const redis = new RecordingRedis(8);
    const backend = new RedisBucketBackend(redis);

    expect(await backend.cycle("identity|shared", limits, 0, 0, 8, now)).toBe(8);

    expect(redis.calls).toHaveLength(1);
    const call = redis.calls[0];
    expect(call?.script).toBe(CYCLE_POOL_LUA);
    expect(call?.numKeys).toBe(1);
    expect(call?.args[0]).toBe("awall:bucket:identity|shared");
    expect(call?.args[7]).toBe(String(poolTtlSeconds(limits) * 1000));
    expect(call?.script).toContain("redis.call('PEXPIRE', key, ttl)");
  });

  it("expires the key on the release path too", async () => {
    const redis = new RecordingRedis(0);
    const backend = new RedisBucketBackend(redis);

    await backend.release("identity|shared", limits, 3, now);

    expect(redis.calls).toHaveLength(1);
    expect(redis.calls[0]?.args[7]).toBe(String(poolTtlSeconds(limits) * 1000));
  });

  it("gives a different lifetime to a scope with a different window", async () => {
    const redis = new RecordingRedis(1);
    const backend = new RedisBucketBackend(redis);
    // A window of 60s against the 600s window above, so the lifetimes differ.
    const slow: BucketLimits = { capacity: 60, refillPerSecond: 1 };

    await backend.cycle("identity|GET /v1/reports/*", slow, 0, 0, 1, now);

    expect(redis.calls[0]?.args[7]).toBe(String(poolTtlSeconds(slow) * 1000));
    expect(poolTtlSeconds(slow)).not.toBe(poolTtlSeconds(limits));
  });
});
