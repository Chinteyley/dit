import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PROP_RUNS, engineFor, rawEstimatesArb } from './test-support';
import { MAX_UNIT, MIN_UNIT, applyEstimateGuards, unitToWpm, wpmToUnit } from './timing';

describe('timing properties', () => {
  it('converts WPM to a unit and back', () => {
    // Feature: morse-engine, Property 2: WPM and Unit conversions are inverse
    fc.assert(
      fc.property(fc.double({ min: 0.1, max: 1e4, noNaN: true }), (wpm) => {
        expect(wpmToUnit(wpm)).toBe(1200 / wpm);
        expect(Math.abs(unitToWpm(wpmToUnit(wpm)) - wpm)).toBeLessThanOrEqual(1e-12 * wpm);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('guards any positive estimates into valid, stable values that the engine reports', () => {
    // Feature: morse-engine, Property 3: Estimate_Guards produce valid, stable estimates
    fc.assert(
      fc.property(rawEstimatesArb, (raw) => {
        const guarded = applyEstimateGuards(raw);
        const { dotEstimate: dot, dashEstimate: dash } = guarded;
        expect(dot).toBeGreaterThanOrEqual(MIN_UNIT);
        expect(dot).toBeLessThanOrEqual(MAX_UNIT);
        expect(dash).toBeGreaterThanOrEqual(MIN_UNIT);
        expect(dash).toBeLessThanOrEqual(3 * MAX_UNIT);
        expect(dash).toBeGreaterThanOrEqual(1.5 * dot);
        expect(applyEstimateGuards(guarded)).toStrictEqual(guarded);

        for (const mode of ['adaptive', 'fixed'] as const) {
          const engine = engineFor({
            mode,
            initialDotEstimate: raw.dotEstimate,
            initialDashEstimate: raw.dashEstimate,
          });
          expect(engine.estimates()).toStrictEqual({
            dotEstimate: dot,
            dashEstimate: dash,
            dotDashThreshold: (dot + dash) / 2,
            letterGapThreshold: 2 * dot,
            wordGapThreshold: 4.5 * dot,
          });
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
