import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROP_RUNS, engineFor } from './test-support';

const PRESSES = 40;

const keyerArb = fc
  .record({
    wpm: fc.double({ min: 2, max: 20, noNaN: true }),
    ratio: fc.double({ min: 0.75, max: 1.75, noNaN: true }),
    // true = dot, false = dash; at least 15 of each kind.
    kinds: fc
      .array(fc.boolean(), { minLength: PRESSES, maxLength: PRESSES })
      .filter((kinds) => {
        const dots = kinds.filter(Boolean).length;
        return dots >= 15 && dots <= 25;
      }),
    factors: fc.array(fc.double({ min: 0.9, max: 1.1, noNaN: true }), {
      minLength: PRESSES,
      maxLength: PRESSES,
    }),
  })
  .filter(({ wpm, ratio }) => ratio * (1200 / wpm) >= 60);

describe('convergence properties', () => {
  it('converges on a user who keys consistently faster or slower than the start speed', () => {
    // Feature: morse-engine, Property 14: Adaptive estimates converge on a consistent keyer
    fc.assert(
      fc.property(keyerArb, ({ wpm, ratio, kinds, factors }) => {
        const engine = engineFor({ startingWpm: wpm });
        const startUnit = 1200 / wpm;
        const trueUnit = Math.max(ratio * startUnit, 60);
        let t = 0;
        kinds.forEach((isDot, i) => {
          const factor = factors[i] ?? 1;
          const length = (isDot ? trueUnit : 3 * trueUnit) * factor;
          engine.press(t);
          t += length;
          const [symbol] = engine.release(t);
          expect(symbol).toStrictEqual({ type: 'symbol', symbol: isDot ? '.' : '-' });
          t += trueUnit; // 1-unit gap: never a letter gap, so only every 10th symbol commits
        });
        const { dotEstimate, dashEstimate } = engine.estimates();
        expect(Math.abs(dotEstimate - trueUnit)).toBeLessThanOrEqual(0.15 * trueUnit);
        expect(Math.abs(dashEstimate - 3 * trueUnit)).toBeLessThanOrEqual(0.45 * trueUnit);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
