import { describe, expect, it } from "vitest";
import { InProcessBucketBackend, SharedBucketStore } from "../src/shared-bucket.js";

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
