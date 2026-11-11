import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { step, type EngineInput } from './decoder';
import {
  PROP_RUNS,
  engineFor,
  feed,
  inputSequenceArb,
  keyedTextArb,
  validConfigArb,
} from './test-support';

describe('reset properties', () => {
  it('clears the character in progress and keeps the learned speed', () => {
    // Feature: morse-engine, Property 15: Reset clears the character and keeps the learned speed
    fc.assert(
      fc.property(
        validConfigArb,
        inputSequenceArb(),
        keyedTextArb,
        fc.double({ min: 0, max: 1e5, noNaN: true }),
        (config, prefix, suffix, gap) => {
          const engine = engineFor(config);
          feed(engine, prefix);
          const before = engine.snapshot();
          const estimates = engine.estimates();

          expect(step(before, { type: 'reset' }).events).toStrictEqual([]);
          engine.reset();
          const after = engine.snapshot();
          expect(engine.estimates()).toStrictEqual(estimates);
          expect(engine.mode).toBe(before.mode);
          expect(after.alpha).toBe(before.alpha);
          expect(after.buffer).toBe('');
          expect(after.switchDown).toBe(false);
          expect(after.spaceEligible).toBe(false);
          expect(engine.nextDeadline()).toBeNull();

          // After reset the engine behaves like a fresh one that starts from the learned estimates.
          const start = (before.lastT ?? 0) + gap;
          const shifted = suffix.inputs.map(
            (input): EngineInput => (input.type === 'reset' ? input : { ...input, t: start + input.t }),
          );
          const fresh = engineFor({
            mode: before.mode,
            startingWpm: config.startingWpm ?? 6,
            adaptationRate: before.alpha,
            initialDotEstimate: before.estimates.dotEstimate,
            initialDashEstimate: before.estimates.dashEstimate,
          });
          expect(fresh.estimates()).toStrictEqual(estimates);
          const resumed = feed(engine, shifted);
          const baseline = feed(fresh, shifted);
          expect(resumed.perCall).toStrictEqual(baseline.perCall);
          expect(engine.estimates()).toStrictEqual(fresh.estimates());

          const firstSpace = resumed.events.findIndex((event) => event.type === 'space');
          const firstChar = resumed.events.findIndex((event) => event.type === 'char');
          if (firstSpace !== -1) {
            expect(firstChar).not.toBe(-1);
            expect(firstChar).toBeLessThan(firstSpace);
          }
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
