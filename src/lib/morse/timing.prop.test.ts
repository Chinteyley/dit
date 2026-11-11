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

// Feature: morse-engine, review 17.1: calibration sets the gap unit too.
it('decodes calibrated fast letters across 240–350 ms letter pauses', () => {
  fc.assert(fc.property(fc.integer({ min: 240, max: 350 }), (gap) => {
    const engine = engineFor({ startingWpm: 6, mode: 'fixed', initialDotEstimate: 80, initialDashEstimate: 240 });
    let t = 0;
    const chars: string[] = [];
    for (const pattern of ['..', '.--', '-', '--.', '---']) {
      for (const symbol of pattern) {
        chars.push(...engine.press(t).flatMap((e) => e.type === 'char' ? [e.char] : []));
        t += symbol === '.' ? 80 : 240;
        engine.release(t);
        t += 80;
      }
      t += gap - 80;
    }
    chars.push(...engine.tick(t).flatMap((e) => e.type === 'char' ? [e.char] : []));
    expect(chars.join('')).toBe('iwtgo');
    expect(engine.estimates()).toMatchObject({ letterGapThreshold: 160, wordGapThreshold: 360 });
  }), { numRuns: PROP_RUNS });
});

it('retains the Starting-WPM gap floor without calibration', () => {
  fc.assert(fc.property(fc.integer({ min: 60, max: 100 }), (dot) => {
    const engine = engineFor({ startingWpm: 6 });
    let t = 0;
    for (let i = 0; i < 20; i += 1) {
      engine.press(t);
      engine.release(t + dot);
      t += dot + 80;
    }
    expect(engine.estimates().dotEstimate).toBeLessThan(200);
    expect(engine.estimates()).toMatchObject({ letterGapThreshold: 400, wordGapThreshold: 900 });
  }), { numRuns: PROP_RUNS });
});
