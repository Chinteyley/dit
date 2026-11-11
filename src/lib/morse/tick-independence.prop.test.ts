import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { EngineInput } from './decoder';
import {
  PROP_RUNS,
  engineFor,
  feed,
  inputSequenceArb,
  insertExtraTicks,
  timeOf,
  validConfigArb,
} from './test-support';

/**
 * Requirement 15.5 only holds when finite timestamps never decrease. With a stale input, a tick
 * inserted between earlier neighbours can turn a later input from accepted into ignored (for example
 * press 100, press 200 (ignored while down), release 150 with an extra tick at 180). The sequences
 * here therefore use only non-finite bad timestamps.
 */
const sequenceArb = fc
  .tuple(
    inputSequenceArb({ noReset: true, monotonic: true }),
    fc.double({ min: 0, max: 12, noNaN: true }),
  )
  .map(([inputs, lastDt]): readonly EngineInput[] => {
    const lastT = inputs.reduce((latest, input) => Math.max(latest, timeOf(input) ?? latest), 0);
    // End with a release so the switch is up.
    return [...inputs, { type: 'release', t: lastT + lastDt * 100 }];
  });

describe('tick independence properties', () => {
  it('gives the same events and estimates whatever extra ticks the UI sends', () => {
    // Feature: morse-engine, Property 23: Extra ticks never change the outcome
    fc.assert(
      fc.property(
        validConfigArb,
        sequenceArb.chain((inputs) => fc.tuple(fc.constant(inputs), insertExtraTicks(inputs))),
        fc.double({ min: 0, max: 1e4, noNaN: true }),
        (config, [inputs, withTicks], extra) => {
          // The final deadline: last release plus the word gap in effect after it.
          const probe = engineFor(config);
          feed(probe, inputs);
          const state = probe.snapshot();
          const deadline =
            state.lastRelease === null ? 0 : state.lastRelease + 4.5 * Math.max(state.estimates.dotEstimate, state.gapUnitFloor);
          const finalTick: EngineInput = { type: 'tick', t: Math.max(deadline, state.lastT ?? 0) + extra };

          const plain = engineFor(config);
          const ticked = engineFor(config);
          const a = feed(plain, [...inputs, finalTick]);
          const b = feed(ticked, [...withTicks, finalTick]);
          expect(b.events).toStrictEqual(a.events);
          expect(ticked.estimates().dotEstimate).toBe(plain.estimates().dotEstimate);
          expect(ticked.estimates().dashEstimate).toBe(plain.estimates().dashEstimate);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
