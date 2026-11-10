import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit';
import { PROP_RUNS } from './test-support/arbitraries';

const LIMIT = 30;
const WINDOW = 60_000;

const deltaArb = fc.oneof(fc.constant(0), fc.integer({ min: 1, max: 100 }), fc.integer({ min: 1_000, max: 70_000 }));
const scriptArb = fc
  .integer({ min: 1, max: 4 })
  .chain((keys) =>
    fc.array(fc.tuple(fc.integer({ min: 0, max: keys - 1 }), deltaArb), { maxLength: 200, size: 'max' }),
  );

describe('rate limiter properties', () => {
  it('never allows more than 30 requests per key in any 60 s window', () => {
    // Feature: expansion, Property 17: The rate limiter never allows more than 30 per 60 s window per key
    fc.assert(
      fc.property(scriptArb, (script) => {
        const limiter = createRateLimiter({ limit: LIMIT, windowMs: WINDOW });
        const allowed = new Map<string, number[]>();
        let t = 0;
        for (const [keyIndex, delta] of script) {
          t += delta;
          const key = `10.0.0.${keyIndex}`;
          const history = allowed.get(key) ?? [];
          const inWindow = history.filter((ti) => t - ti < WINDOW);
          const decision = limiter.check(key, t);
          if (inWindow.length >= LIMIT) {
            const oldest = Math.min(...inWindow);
            const retry = Math.ceil((oldest + WINDOW - t) / 1000);
            expect(decision).toStrictEqual({ allowed: false, retryAfterSeconds: retry });
            expect(retry).toBeGreaterThanOrEqual(1);
            expect(retry).toBeLessThanOrEqual(60);
          } else {
            expect(decision).toStrictEqual({ allowed: true });
            history.push(t);
            allowed.set(key, history);
            expect(history.filter((ti) => ti > t - WINDOW && ti <= t).length).toBeLessThanOrEqual(LIMIT);
          }
          const live = [...allowed.values()].filter((times) => {
            const newest = times[times.length - 1];
            return newest !== undefined && t - newest < WINDOW;
          }).length;
          expect(limiter.size()).toBe(live);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
