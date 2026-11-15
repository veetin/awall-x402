import { describe, expect, it } from "vitest";
import { TokenBucket } from "../src/bucket.js";

describe("TokenBucket", () => {
  it("spends until empty, then refuses", () => {
    const bucket = new TokenBucket(100, 100 / 60, 0);
    expect(bucket.take(60, 0)).toBe(true);
    expect(bucket.take(40, 0)).toBe(true);
    expect(bucket.take(1, 0)).toBe(false);
  });

  it("refills over time, capped at capacity", () => {
    const bucket = new TokenBucket(100, 1, 0);
    bucket.take(100, 0);
    expect(bucket.remaining(10_000)).toBe(10);
    expect(bucket.remaining(10_000_000)).toBe(100);
  });

  it("gives units back when the origin fails", () => {
    const bucket = new TokenBucket(100, 1, 0);
    bucket.take(50, 0);
    bucket.refund(50, 0);
    expect(bucket.remaining(0)).toBe(100);
  });
});
