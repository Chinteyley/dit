import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PROP_RUNS,
  configArb,
  engineFor,
  feed,
  guardedEstimatesArb,
  inputSequenceArb,
} from './test-support';
import { MAX_UNIT, MIN_UNIT, applyEstimateGuards } from './timing';
import type { Estimates } from './types';

/** The clamped EMA model of Requirements 8.1–8.3, written independently of adapt.ts. */
function modelUpdate(prior: Estimates, symbol: '.' | '-', duration: number, alpha: number): Estimates {
  const estimate = symbol === '.' ? prior.dotEstimate : prior.dashEstimate;
  const observation = Math.min(Math.max(duration, 0.5 * estimate), 2 * estimate);
  const next = estimate + alpha * (observation - estimate);
  return applyEstimateGuards(
    symbol === '.'
      ? { dotEstimate: next, dashEstimate: prior.dashEstimate }
      : { dotEstimate: prior.dotEstimate, dashEstimate: next },
  );
}

function expectInsideGuards({ dotEstimate: dot, dashEstimate: dash }: Estimates): void {
  expect(dot).toBeGreaterThanOrEqual(MIN_UNIT);
  expect(dot).toBeLessThanOrEqual(MAX_UNIT);
  expect(dash).toBeGreaterThanOrEqual(MIN_UNIT);
  expect(dash).toBeLessThanOrEqual(3 * MAX_UNIT);
  expect(dash).toBeGreaterThanOrEqual(1.5 * dot);
}

describe('adaptation properties', () => {
  it('updates the classified estimate by the clamped EMA and nothing else moves it', () => {
    // Feature: morse-engine, Property 11: Adaptive update matches the clamped EMA model
    fc.assert(
      fc.property(
        guardedEstimatesArb,
        fc.double({ min: 1e-6, max: 1, noNaN: true }),
        fc.constantFrom('.', '-'),
        fc.double({ min: 0.1, max: 5, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (estimates, alpha, target, factor, t0) => {
          const engine = engineFor({
            mode: 'adaptive',
            adaptationRate: alpha,
            initialDotEstimate: estimates.dotEstimate,
            initialDashEstimate: estimates.dashEstimate,
          });
          const prior = { dotEstimate: estimates.dotEstimate, dashEstimate: estimates.dashEstimate };
          const current = (): Estimates => {
            const { dotEstimate, dashEstimate } = engine.estimates();
            return { dotEstimate, dashEstimate };
          };

          engine.press(t0);
          engine.tick(t0);
          expect(current()).toStrictEqual(prior);

          const d = factor * (target === '.' ? prior.dotEstimate : prior.dashEstimate);
          const releaseAt = t0 + d;
          const duration = releaseAt - t0;
          const symbol = releaseAt >= t0 + (prior.dotEstimate + prior.dashEstimate) / 2 ? '-' : '.';
          expect(engine.release(releaseAt)).toStrictEqual([{ type: 'symbol', symbol }]);
          const updated = modelUpdate(prior, symbol, duration, alpha);
          expect(current()).toStrictEqual(updated);

          // Ticks, presses and a zero-length release leave the estimates alone.
          engine.tick(releaseAt + d);
          engine.press(releaseAt + 2 * d);
          engine.release(releaseAt + 2 * d);
          engine.tick(releaseAt + 100 * d);
          expect(current()).toStrictEqual(updated);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });

  it('keeps adaptive estimates inside the guard bounds after every input', () => {
    // Feature: morse-engine, Property 12: Estimates stay inside the guard bounds
    fc.assert(
      fc.property(
        configArb('adaptive'),
        inputSequenceArb({ durationScale: fc.double({ min: -3, max: 6, noNaN: true }).map((x) => 10 ** x) }),
        (config, inputs) => {
          const engine = engineFor(config);
          expectInsideGuards(engine.estimates());
          feed(engine, inputs, () => {
            expectInsideGuards(engine.estimates());
          });
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });

  it('never moves fixed-speed estimates', () => {
    // Feature: morse-engine, Property 13: Fixed-speed estimates never move
    fc.assert(
      fc.property(configArb('fixed'), inputSequenceArb(), (config, inputs) => {
        const engine = engineFor(config);
        const { dotEstimate, dashEstimate } = engine.estimates();
        feed(engine, inputs, () => {
          expect(engine.estimates().dotEstimate).toBe(dotEstimate);
          expect(engine.estimates().dashEstimate).toBe(dashEstimate);
        });
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
