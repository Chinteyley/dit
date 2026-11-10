/**
 * Sliding-window rate limit for POST /api/expand (Requirement 12.3 and 12.7). Pure: the caller
 * passes the time in. Counts live in the memory of one server instance only; nothing is logged
 * or stored.
 */

export interface RateLimitConfig {
  readonly limit: number;
  readonly windowMs: number;
}

export type RateDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly retryAfterSeconds: number };

export interface RateLimiter {
  /** Decides for one request and counts it when it is allowed. */
  check(key: string, nowMs: number): RateDecision;
  /** Number of keys with a counted request in the current window (for tests). */
  size(): number;
}

/** The shared key for requests that carry no client address. */
export const UNKNOWN_CLIENT_KEY = 'unknown';

const RETRY_MIN_SECONDS = 1;
const RETRY_MAX_SECONDS = 60;

/**
 * Keeps the timestamps less than `windowMs` old. At `limit` or more it rejects without counting,
 * with the whole seconds until the oldest kept request leaves the window (1 to 60). Otherwise it
 * counts `nowMs` and allows.
 */
export function decide(
  times: readonly number[],
  nowMs: number,
  cfg: RateLimitConfig,
): { readonly decision: RateDecision; readonly times: readonly number[] } {
  const kept = times.filter((t) => nowMs - t < cfg.windowMs);
  if (kept.length >= cfg.limit) {
    const oldest = Math.min(...kept);
    const seconds = Math.ceil((oldest + cfg.windowMs - nowMs) / 1000);
    const retryAfterSeconds = Math.min(RETRY_MAX_SECONDS, Math.max(RETRY_MIN_SECONDS, seconds));
    return { decision: { allowed: false, retryAfterSeconds }, times: kept };
  }
  return { decision: { allowed: true }, times: [...kept, nowMs] };
}

/**
 * A limiter over a Map whose insertion order is the order of each key's newest counted request
 * (allowed requests delete and re-set their key), so expired keys are always at the front.
 */
export function createRateLimiter(config: RateLimitConfig): RateLimiter {
  const entries = new Map<string, readonly number[]>();

  function expire(nowMs: number): void {
    for (const [key, times] of entries) {
      const newest = times[times.length - 1];
      if (newest !== undefined && nowMs - newest < config.windowMs) break;
      entries.delete(key);
    }
  }

  return {
    check(key, nowMs) {
      expire(nowMs);
      const { decision, times } = decide(entries.get(key) ?? [], nowMs, config);
      if (decision.allowed) {
        entries.delete(key);
        entries.set(key, times);
      } else {
        entries.set(key, times);
      }
      return decision;
    },
    size() {
      return entries.size;
    },
  };
}
