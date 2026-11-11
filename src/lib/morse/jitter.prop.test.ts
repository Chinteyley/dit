import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodedText } from './decoder';
import { normalizeText } from './encode';
import { PROP_RUNS, engineFor, feed, jitteredSequenceArb, withEndTick } from './test-support';

describe('jitter properties', () => {
  it('decodes the same events when every press and gap is off by up to ±30%', () => {
    // Feature: morse-engine, Property 21: Decoding survives ±30% jitter on every element
    fc.assert(
      fc.property(jitteredSequenceArb, ({ text, unit, base, jittered }) => {
        const decode = (inputs: ReturnType<typeof withEndTick>) =>
          feed(engineFor({ mode: 'fixed', startingWpm: 20, initialDotEstimate: unit, initialDashEstimate: 3 * unit }), inputs).events;
        const expected = decode(withEndTick(base));
        const actual = decode(withEndTick(jittered));
        expect(actual).toStrictEqual(expected);
        expect(decodedText(actual)).toBe(normalizeText(text));
        expect(decodedText(actual).endsWith(' ')).toBe(false);
        expect(actual.filter((event) => event.type === 'unknown' || event.type === 'command')).toStrictEqual([]);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
