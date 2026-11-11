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
            letterGapThreshold: 2 * Math.max(dot, 200),
            wordGapThreshold: 4.5 * Math.max(dot, 200),
          });
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});

// Feature: morse-engine, review 17.1: short presses do not accelerate thinking pauses.
it('keeps calibrated fast dots together across pauses shorter than the starting letter gap', () => {
  fc.assert(fc.property(fc.integer({ min: 60, max: 100 }), fc.integer({ min: 210, max: 390 }), (dot, gap) => {
    const engine = engineFor({ startingWpm: 6, mode: 'fixed', initialDotEstimate: dot, initialDashEstimate: dot * 3 });
    for (let i = 0; i < 3; i += 1) {
      const start = i * (dot + gap);
      expect(engine.press(start)).toEqual([]);
      expect(engine.release(start + dot)).toEqual([{ type: 'symbol', symbol: '.' }]);
    }
    const end = 2 * (dot + gap) + dot;
    expect(engine.nextDeadline()).toBe(end + 400);
    expect(engine.tick(end + 400)).toEqual([{ type: 'char', char: 's' }]);
    expect(engine.nextDeadline()).toBe(end + 900);
    expect(engine.tick(end + 900)).toEqual([{ type: 'space' }]);
  }), { numRuns: PROP_RUNS });
});
