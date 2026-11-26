/** Weight of a new sample in the exponential moving average. */
export const ABUSE_ALPHA = 0.35;

/** Intervals shorter than this are treated as a burst, even after the average adapts. */
const FAST_INTERVAL_MS = 80;

export type AbuseSignals = {
  /** Requests arriving much faster than this identity's recent interval. */
  burst: number;
  /** Share of requests identical to the previous one. */
  identical: number;
  /** Share of origin responses in the 4xx range. */
  errors: number;
  /** Share of requests that bypass cache validators. */
  cache: number;
};

export type AbuseState = {
  signals: AbuseSignals;
  /** Observations folded in. The price ignores the score until this reaches 8. */
  samples: number;
  lastAt: number | null;
  intervalEmaMs: number | null;
  lastHash: string | null;
};

export type AbuseObservation = {
  now: number;
  /** Hash of method, path, query and body. */
  requestHash: string;
  /** Origin status, when the origin was reached. `null` leaves the error signal unchanged. */
  originStatus: number | null;
  /** `Cache-Control: no-cache` / `no-store`, or `Pragma: no-cache`. */
  ignoresCacheValidators: boolean;
};

/** A new identity: every signal is zero, so the price multiplier is 1. */
export function initialAbuseState(score = 0): AbuseState {
  const seeded = clamp01(score);
  return {
    signals: { burst: seeded, identical: seeded, errors: seeded, cache: seeded },
    // A stored score already survived a previous process, so it may price immediately.
    samples: seeded > 0 ? 8 : 0,
    lastAt: null,
    intervalEmaMs: null,
    lastHash: null,
  };
}

/** Mean of the four signals, in [0, 1]. */
export function abuseScoreOf(state: AbuseState): number {
  const { burst, identical, errors, cache } = state.signals;
  return clamp01((burst + identical + errors + cache) / 4);
}

/**
 * Score used to price an offer.
 *
 * The first requests of a new identity are not evidence: exhausting a small
 * free quota, or two retries, must not raise the price. Eight observations is
 * enough for the moving average to mean something.
 *
 * @param state - Score so far.
 * @returns The score, or 0 while the identity is still new.
 */
export function pricedAbuseScore(state: AbuseState): number {
  if (state.samples < 8) return 0;
  return abuseScoreOf(state);
}

/**
 * Fold one request into the score.
 *
 * Each signal is an exponential moving average. The combined score is what
 * `priceFor` multiplies, and `pricing.max_multiplier` caps the result.
 *
 * @param state - Score so far for this identity.
 * @param observation - What this request looked like.
 * @returns The next state. The input is not mutated.
 */
export function observeAbuse(state: AbuseState, observation: AbuseObservation): AbuseState {
  let burstSample = 0;
  let intervalEmaMs = state.intervalEmaMs;
  if (state.lastAt !== null) {
    const interval = Math.max(0, observation.now - state.lastAt);
    if (intervalEmaMs === null) {
      intervalEmaMs = interval;
    } else {
      const expected = Math.max(intervalEmaMs, 1);
      burstSample = clamp01(1 - interval / expected);
      intervalEmaMs = ema(intervalEmaMs, interval);
    }
    if (interval < FAST_INTERVAL_MS) {
      burstSample = Math.max(burstSample, clamp01(1 - interval / FAST_INTERVAL_MS));
    }
  }

  const identicalSample =
    state.lastHash !== null && state.lastHash === observation.requestHash ? 1 : 0;
  const cacheSample = observation.ignoresCacheValidators ? 1 : 0;
  const errors =
    observation.originStatus === null
      ? state.signals.errors
      : ema(
          state.signals.errors,
          observation.originStatus >= 400 && observation.originStatus < 500 ? 1 : 0,
        );

  return {
    signals: {
      burst: ema(state.signals.burst, burstSample),
      identical: ema(state.signals.identical, identicalSample),
      errors,
      cache: ema(state.signals.cache, cacheSample),
    },
    samples: state.samples + 1,
    lastAt: observation.now,
    intervalEmaMs,
    lastHash: observation.requestHash,
  };
}

/**
 * Whether the request tells caches to ignore validators.
 *
 * A missing `If-None-Match` is normal for an API client, so only an explicit
 * bypass counts. Otherwise every well-behaved agent would look abusive.
 *
 * @param headers - Request headers.
 * @returns True when `Cache-Control` or `Pragma` asks for a bypass.
 */
export function ignoresCacheValidators(headers: Headers): boolean {
  const cacheControl = headers.get("cache-control")?.toLowerCase() ?? "";
  if (cacheControl.includes("no-cache") || cacheControl.includes("no-store")) return true;
  return (headers.get("pragma")?.toLowerCase() ?? "").includes("no-cache");
}

function ema(previous: number, sample: number): number {
  return ABUSE_ALPHA * sample + (1 - ABUSE_ALPHA) * previous;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
