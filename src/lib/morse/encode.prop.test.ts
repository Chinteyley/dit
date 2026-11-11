import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE } from './codes';
import { encode } from './encode';
import {
  PROP_RUNS,
  WHITESPACE_CHARS,
  supportedCharArb,
  supportedStringArb,
  unitArb,
} from './test-support';

/** Oracle normalization, written independently of normalizeText. */
function oracleWords(text: string): string[] {
  return text
    .replace(/[A-Z]/g, (letter) => letter.toLowerCase())
    .split(/[ \t\n\r]+/)
    .filter((word) => word !== '');
}

/** Expected [pressUnits, releaseUnits] per symbol, and the End_Time in units. */
function oracleSchedule(text: string): { pairs: [number, number][]; endUnits: number } {
  const pairs: [number, number][] = [];
  let k = 0;
  oracleWords(text).forEach((word, wordIndex) => {
    [...word].forEach((char, charIndex) => {
      [...(CHARACTER_TABLE[char] ?? '')].forEach((symbol, symbolIndex) => {
        if (symbolIndex > 0) k += 1;
        else if (charIndex > 0) k += 3;
        else if (wordIndex > 0) k += 7;
        const start = k;
        k += symbol === '.' ? 1 : 3;
        pairs.push([start, k]);
      });
    });
  });
  return { pairs, endUnits: k + 3 };
}

const lowerAZ = (text: string): string => text.replace(/[A-Z]/g, (letter) => letter.toLowerCase());

const UNSUPPORTED_POOL = ['+', '#', 'é', '€', '\u00a0', '\v', '😀', '~', 'Ω'];

const invalidUnitArb = fc.oneof(
  fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -60, 59.999999, 1500.000001),
  fc.double({ min: 0, max: 60, maxExcluded: true, noNaN: true }),
  fc.double({ min: 1500, max: 1e6, minExcluded: true, noNaN: true }),
  fc.double({ min: -1e6, max: 0, noNaN: true }),
);

/** A Supported_String with unsupported code points inserted, and the occurrences the encoder must report. */
const pollutedTextArb = fc
  .tuple(
    supportedStringArb,
    fc.array(fc.tuple(fc.nat(), fc.constantFrom(...UNSUPPORTED_POOL)), { minLength: 1, maxLength: 8 }),
  )
  .map(([base, insertions]) => {
    const parts: { char: string; inserted: boolean }[] = [...base].map((char) => ({ char, inserted: false }));
    for (const [position, char] of insertions) {
      parts.splice(position % (parts.length + 1), 0, { char, inserted: true });
    }
    const occurrences: { char: string; index: number }[] = [];
    let index = 0;
    for (const part of parts) {
      if (part.inserted) occurrences.push({ char: part.char, index });
      index += part.char.length;
    }
    return { text: parts.map((part) => part.char).join(''), occurrences };
  });

const whitespaceOnlyArb = fc
  .array(fc.constantFrom(...WHITESPACE_CHARS), { maxLength: 10 })
  .map((chars) => chars.join(''));

describe('encoder properties', () => {
  it('produces exact Morse timing for every supported string', () => {
    // Feature: morse-engine, Property 18: Encoded sequences have exact Morse timing
    fc.assert(
      fc.property(supportedStringArb, unitArb, (text, unit) => {
        const result = encode(text, unit);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const { inputs, endTime } = result.value;
        const { pairs, endUnits } = oracleSchedule(text);

        expect(inputs[0]).toStrictEqual({ type: 'press', t: 0 });
        expect(inputs.every((input, i) => input.type === (i % 2 === 0 ? 'press' : 'release'))).toBe(true);
        expect(inputs.every((input, i) => i === 0 || input.t > (inputs[i - 1]?.t ?? Infinity))).toBe(true);
        expect(inputs).toStrictEqual(
          pairs.flatMap(([pressUnits, releaseUnits]) => [
            { type: 'press', t: pressUnits * unit },
            { type: 'release', t: releaseUnits * unit },
          ]),
        );
        expect(endTime).toBe(endUnits * unit);

        expect(encode(lowerAZ(text), unit)).toStrictEqual(result);
        expect(encode(text, unit)).toStrictEqual(result);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('rejects bad text and bad units, reporting every problem and no sequence', () => {
    // Feature: morse-engine, Property 19: Encoder rejects bad text and bad units completely
    fc.assert(
      fc.property(
        fc.oneof(
          fc.record({
            kind: fc.constant('polluted' as const),
            polluted: pollutedTextArb,
            unit: fc.oneof(unitArb, invalidUnitArb),
          }),
          fc.record({
            kind: fc.constant('empty' as const),
            text: whitespaceOnlyArb,
            unit: fc.oneof(unitArb, invalidUnitArb),
          }),
          fc.record({
            kind: fc.constant('bad-unit' as const),
            text: fc.oneof(supportedStringArb, supportedCharArb),
            unit: invalidUnitArb,
          }),
        ),
        (testCase) => {
          const text = testCase.kind === 'polluted' ? testCase.polluted.text : testCase.text;
          const unitValid = Number.isFinite(testCase.unit) && testCase.unit >= 60 && testCase.unit <= 1500;
          const result = encode(text, testCase.unit);
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect('value' in result).toBe(false);

          const expectedText =
            testCase.kind === 'polluted'
              ? { kind: 'unsupported', occurrences: testCase.polluted.occurrences }
              : testCase.kind === 'empty'
                ? { kind: 'empty' }
                : undefined;
          expect(result.error).toStrictEqual({
            ...(unitValid ? {} : { unit: { value: testCase.unit } }),
            ...(expectedText === undefined ? {} : { text: expectedText }),
          });
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
