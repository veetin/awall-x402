/**
 * How long a decision-mode reservation stays redeemable, in milliseconds.
 *
 * In decision mode the gateway never sees the origin response, so the real cost
 * only arrives later through `POST /awall/usage`. The reservation id is the
 * capability that authorizes that call, and an edge that never reports back
 * would otherwise leave the entry in memory for the life of the process: the
 * map would grow without bound and a stale id would stay redeemable forever.
 *
 * Five minutes is well above any reasonable edge round trip — including a slow
 * metered completion — and short enough that a leaked id is not a standing
 * capability. Documented in docs/07-producao.md.
 */
export const RESERVATION_TTL_MS = 5 * 60 * 1000;

type Entry<T> = { value: T; expiresAt: number };

/**
 * In-process reservations, each with a bounded lifetime.
 *
 * Every entry gets the same TTL, so insertion order is also expiry order and a
 * `Map` iterates oldest first. Pruning therefore walks the front of the map and
 * stops at the first entry that is still alive: no scan of the whole map on a
 * request, and every entry is visited once before it is dropped.
 */
export class ReservationStore<T> {
  private readonly entries = new Map<string, Entry<T>>();
  private readonly ttlMs: number;

  /**
   * @param ttlMs - Lifetime of a reservation. Tests override it; nothing else.
   */
  constructor(ttlMs: number = RESERVATION_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Record a reservation and drop the ones that have already expired.
   *
   * @param id - Reservation id handed to the edge.
   * @param value - What the gateway needs when the usage report arrives.
   * @param now - Current time, milliseconds.
   */
  set(id: string, value: T, now: number): void {
    this.prune(now);
    this.entries.set(id, { value, expiresAt: now + this.ttlMs });
  }

  /**
   * Consume a reservation. An expired one is dropped and refused.
   *
   * @param id - Reservation id presented by the edge.
   * @param now - Current time, milliseconds.
   * @returns The reservation, or `undefined` when it is unknown or expired.
   */
  take(id: string, now: number): T | undefined {
    this.prune(now);
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    this.entries.delete(id);
    if (entry.expiresAt <= now) return undefined;
    return entry.value;
  }

  /** Reservations still held, whether or not the next prune will drop them. */
  get size(): number {
    return this.entries.size;
  }

  /**
   * Drop the expired entries at the front of the map.
   *
   * @param now - Current time, milliseconds.
   */
  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt > now) return;
      this.entries.delete(id);
    }
  }
}
