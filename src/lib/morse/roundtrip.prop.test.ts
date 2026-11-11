import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE } from './codes';
import { decodedText } from './decoder';
import { normalizeText } from './encode';
import {
  PROP_RUNS,
  encodeOrThrow,
  engineFor,
  feed,
  insertExtraTicks,
  supportedCharArb,
  supportedStringArb,
  unitArb,
  withEndTick,
} from './test-support';

const caseArb = fc
  .tuple(fc.oneof(supportedStringArb, supportedCharArb), unitArb)
  .chain(([text, unit]) => {
    const inputs = withEndTick(encodeOrThrow(text, unit));
    return fc.record({
      text: fc.constant(text),
      unit: fc.constant(unit),
      inputs: fc.constant(inputs),
      withTicks: insertExtraTicks(inputs),
    });
  });

describe('roundtrip properties', () => {
  it('decodes an encoded string back to its normalized text, with or without extra ticks', () => {
    // Feature: morse-engine, Property 20: Encode then decode returns the normalized text
    fc.assert(
      fc.property(caseArb, ({ text, unit, inputs, withTicks }) => {
        const normalized = normalizeText(text);
        const expectedSymbols = [...normalized.replaceAll(' ', '')].flatMap((char) => [
          ...(CHARACTER_TABLE[char] ?? ''),
        ]);
        for (const sequence of [inputs, withTicks]) {
          const engine = engineFor({ mode: 'fixed', startingWpm: 20, initialDotEstimate: unit, initialDashEstimate: 3 * unit });
          const { events } = feed(engine, sequence);
          expect(decodedText(events)).toBe(normalized);
          const symbols = events.flatMap((event) => (event.type === 'symbol' ? [event.symbol] : []));
          expect(symbols).toStrictEqual(expectedSymbols);
          expect(events.filter((event) => event.type === 'command' || event.type === 'unknown')).toStrictEqual([]);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
