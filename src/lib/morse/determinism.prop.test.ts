import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calibrate, createEngine, encode } from './index';
import {
  PROP_RUNS,
  apply,
  inputSequenceArb,
  supportedStringArb,
  unitArb,
  validConfigArb,
} from './test-support';

describe('determinism properties', () => {
  it('replays identically for the same inputs', () => {
    // Feature: morse-engine, Property 22: Replays are deterministic
    fc.assert(
      fc.property(
        validConfigArb,
        inputSequenceArb(),
        fc.oneof(supportedStringArb, fc.string()),
        fc.oneof(unitArb, fc.double()),
        fc.anything(),
        (config, inputs, text, unit, practice) => {
          const first = createEngine(config);
          const second = createEngine(config);
          expect(first.ok && second.ok).toBe(true);
          if (!first.ok || !second.ok) return;
          const a = first.value;
          const b = second.value;
          for (const input of inputs) {
            expect(apply(b, input)).toStrictEqual(apply(a, input));
            expect(b.estimates().dotEstimate).toBe(a.estimates().dotEstimate);
            expect(b.estimates().dashEstimate).toBe(a.estimates().dashEstimate);
          }
          expect(encode(text, unit)).toStrictEqual(encode(text, unit));
          expect(calibrate(practice)).toStrictEqual(calibrate(practice));
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
