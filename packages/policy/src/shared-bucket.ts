import type { BucketLimits } from "./bucket.js";

/**
 * Shared free-quota pool.
 *
 * `tokens` are available to any replica. `outstanding` is held by a replica's
 * local lease and is not refillable by anyone else, so two replicas cannot
 * each grant the full quota. Refill never pushes `tokens + outstanding` over
 * capacity.
 */
export type SharedPool = {
  tokens: number;
  outstanding: number;
  updatedAt: number;
};

/** A pool that starts full. */
export function fullPool(capacity: number, now: number): SharedPool {
  return { tokens: capacity, outstanding: 0, updatedAt: now };
}

/**
 * One atomic step: commit spends, give unused lease back, refill, lease more.
 *
 * The whole function mutates `pool` with no await, which is what makes it safe
 * to run as a Redis Lua script: another replica cannot observe a half-applied
 * update.
 *
 * @param pool - Shared pool. Mutated in place.
 * @param limits - Capacity and refill rate of this scope.
 * @param commit - Credits this replica already served from its previous lease.
 * @param release - Credits from that lease it did not spend.
 * @param lease - How many credits to take out for the next local burst.
 * @param now - Current time in milliseconds.
 * @returns Credits moved into the caller's lease.
 */
export function cyclePool(
  pool: SharedPool,
  limits: BucketLimits,
  commit: number,
  release: number,
  lease: number,
  now: number,
): number {
  pool.outstanding -= clamp(commit, pool.outstanding);
  const returning = clamp(release, pool.outstanding);
  pool.outstanding -= returning;
  const roomAfterReturn = limits.capacity - pool.outstanding - pool.tokens;
  if (roomAfterReturn > 0) pool.tokens += Math.min(roomAfterReturn, returning);

  const elapsed = (now - pool.updatedAt) / 1000;
  if (elapsed > 0) {
    const room = limits.capacity - pool.outstanding - pool.tokens;
    if (room > 0) pool.tokens += Math.min(room, elapsed * limits.refillPerSecond);
    pool.updatedAt = now;
  }

  const granted = clamp(lease, pool.tokens);
  pool.tokens -= granted;
  pool.outstanding += granted;
  return granted;
}

/** Give credits back to the shared pool, capped so the total cannot exceed capacity. */
export function releasePool(
  pool: SharedPool,
  limits: BucketLimits,
  amount: number,
  now: number,
): void {
  const returning = clamp(amount, pool.outstanding);
  pool.outstanding -= returning;
  const room = limits.capacity - pool.outstanding - pool.tokens;
  if (room > 0) pool.tokens += Math.min(room, returning);
  pool.updatedAt = now;
}

/**
 * Lua source of {@link cyclePool}, loaded with `EVAL`.
 *
 * KEYS[1] is the pool hash. ARGV is commit, release, lease, now (ms),
 * capacity, refill-per-second. The return value is the leased amount.
 * The script is the only writer, so the read-modify-write cannot interleave.
 */
export const CYCLE_POOL_LUA = `
local key = KEYS[1]
local commit = tonumber(ARGV[1])
local release = tonumber(ARGV[2])
local lease = tonumber(ARGV[3])
local now = tonumber(ARGV[4])
local capacity = tonumber(ARGV[5])
local refill = tonumber(ARGV[6])

local tokens = tonumber(redis.call('HGET', key, 'tokens'))
local outstanding = tonumber(redis.call('HGET', key, 'outstanding'))
local updated = tonumber(redis.call('HGET', key, 'updatedAt'))
if tokens == nil then
  tokens = capacity
  outstanding = 0
  updated = now
end

if commit > outstanding then commit = outstanding end
outstanding = outstanding - commit
if release > outstanding then release = outstanding end
outstanding = outstanding - release
local room = capacity - outstanding - tokens
if room < 0 then room = 0 end
if release < room then room = release end
tokens = tokens + room

local elapsed = (now - updated) / 1000
if elapsed > 0 then
  room = capacity - outstanding - tokens
  if room < 0 then room = 0 end
  local add = elapsed * refill
  if add > room then add = room end
  tokens = tokens + add
  updated = now
end

if lease > tokens then lease = tokens end
if lease < 0 then lease = 0 end
tokens = tokens - lease
outstanding = outstanding + lease

redis.call('HSET', key, 'tokens', tokens, 'outstanding', outstanding, 'updatedAt', updated)
return lease
`.trim();

export type BucketBackend = {
  /** Run one atomic cycle. See {@link cyclePool}. */
  cycle(
    key: string,
    limits: BucketLimits,
    commit: number,
    release: number,
    lease: number,
    now: number,
  ): Promise<number> | number;
  /** Return credits to the pool. See {@link releasePool}. */
  release(key: string, limits: BucketLimits, amount: number, now: number): Promise<void> | void;
};

/**
 * In-process stand-in for Redis. `cycle` mutates synchronously, before the
 * returned promise settles, so two callers cannot both observe the old pool.
 */
export class InProcessBucketBackend implements BucketBackend {
  private readonly pools = new Map<string, SharedPool>();

  cycle(
    key: string,
    limits: BucketLimits,
    commit: number,
    release: number,
    lease: number,
    now: number,
  ): number {
    const pool = this.pool(key, limits, now);
    return cyclePool(pool, limits, commit, release, lease, now);
  }

  release(key: string, limits: BucketLimits, amount: number, now: number): void {
    const pool = this.pool(key, limits, now);
    releasePool(pool, limits, amount, now);
  }

  private pool(key: string, limits: BucketLimits, now: number): SharedPool {
    let pool = this.pools.get(key);
    if (!pool) {
      pool = fullPool(limits.capacity, now);
      this.pools.set(key, pool);
    }
    return pool;
  }
}

type LocalLease = {
  tokens: number;
  uncommitted: number;
  fetchedAt: number;
};

/**
 * Per-replica view of a shared bucket.
 *
 * A burst inside `cacheMs` spends a lease that was already removed from the
 * shared pool, so it does not pay a round trip and it cannot be spent again
 * by another replica. When the cache expires, unused credits go back.
 */
export class SharedBucketStore {
  private readonly local = new Map<string, LocalLease>();

  constructor(
    private readonly backend: BucketBackend,
    private readonly options: { lease: number; cacheMs: number } = { lease: 8, cacheMs: 5 },
  ) {}

  /**
   * Spend credits from the local lease, refilling it atomically when needed.
   *
   * @param key - Identity plus scope.
   * @param limits - Capacity and refill of that scope.
   * @param credits - Units to spend.
   * @param now - Current time in milliseconds.
   * @returns Whether the units were available.
   */
  async take(key: string, limits: BucketLimits, credits: number, now = Date.now()): Promise<boolean> {
    if (credits <= 0) return true;
    let slot = this.local.get(key);
    if (
      slot === undefined ||
      now - slot.fetchedAt > this.options.cacheMs ||
      slot.tokens < credits
    ) {
      const granted = await this.backend.cycle(
        key,
        limits,
        slot?.uncommitted ?? 0,
        slot?.tokens ?? 0,
        Math.max(this.options.lease, credits),
        now,
      );
      slot = { tokens: granted, uncommitted: 0, fetchedAt: now };
      this.local.set(key, slot);
    }
    if (slot.tokens < credits) return false;
    slot.tokens -= credits;
    slot.uncommitted += credits;
    return true;
  }

  /** Put credits back into the local lease. They were already taken out of the pool. */
  async refund(key: string, limits: BucketLimits, credits: number, now = Date.now()): Promise<void> {
    const slot = this.local.get(key);
    if (!slot) {
      await this.backend.release(key, limits, credits, now);
      return;
    }
    const back = Math.min(slot.uncommitted, credits);
    slot.uncommitted -= back;
    slot.tokens += back;
    const rest = credits - back;
    if (rest > 0) await this.backend.release(key, limits, rest, now);
  }

  /** Credits this replica can still spend without asking the pool. */
  remaining(key: string): number {
    return Math.floor(this.local.get(key)?.tokens ?? 0);
  }
}

function clamp(value: number, max: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(value, max);
}
