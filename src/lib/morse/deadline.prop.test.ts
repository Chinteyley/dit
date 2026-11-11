import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { DecoderState, Engine } from './decoder';
import { PROP_RUNS, engineFor, feed, inputSequenceArb, validConfigArb } from './test-support';

function expectedDeadline(state: DecoderState): number | null {
  if (state.switchDown || state.lastRelease === null) return null;
  if (state.buffer !== '') return state.lastRelease + 2 * Math.max(state.estimates.dotEstimate, state.startingUnit);
  if (state.spaceEligible) return state.lastRelease + 4.5 * Math.max(state.estimates.dotEstimate, state.startingUnit);
  return null;
}

/** Everything except lastT, which an accepted tick always advances. */
function withoutClock(state: DecoderState): DecoderState {
  return { ...state, lastT: null };
}

/**
 * Checks one deadline: reads are pure and match the formula, ticks before it are silent, and a tick
 * at it acts. Returns false once nothing is pending.
 */
function checkDeadline(engine: Engine, r: number): boolean {
  const before = engine.snapshot();
  const first = engine.nextDeadline();
  const second = engine.nextDeadline();
  const firstEstimates = engine.estimates();
  const secondEstimates = engine.estimates();
  expect(second).toBe(first);
  expect(secondEstimates).toStrictEqual(firstEstimates);
  expect(engine.snapshot()).toStrictEqual(before);
  expect(first).toBe(expectedDeadline(before));

  const now = before.lastT ?? 0;
  if (first === null) {
    // Switch down, or nothing pending: every valid tick is silent.
    expect(engine.tick(now + r * 1e6)).toStrictEqual([]);
    expect(withoutClock(engine.snapshot())).toStrictEqual(withoutClock(before));
    return false;
  }

  expect(first).toBeGreaterThan(now);
  const early = now + r * (first - now);
  if (early < first) {
    expect(engine.tick(early)).toStrictEqual([]);
    expect(withoutClock(engine.snapshot())).toStrictEqual(withoutClock(before));
  }
  expect(engine.tick(first).length).toBeGreaterThan(0);
  return true;
}

describe('deadline properties', () => {
  it('reports the next deadline without side effects, and tick agrees with it', () => {
    // Feature: morse-engine, Property 10: nextDeadline is pure and agrees with tick
    fc.assert(
      fc.property(
        validConfigArb,
        inputSequenceArb(),
        fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 3, maxLength: 3 }),
        (config, prefix, ratios) => {
          const engine = engineFor(config);
          feed(engine, prefix);
          // Follow the deadlines: a letter-gap commit of a char leads to a word-gap deadline.
          for (const r of ratios) {
            if (!checkDeadline(engine, r)) break;
          }
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
