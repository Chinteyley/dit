import fc from 'fast-check';
import { describe, it } from 'vitest';
import { CHARACTER_TABLE, COMMAND_TABLE, SUPPORTED_CHARACTERS, lookupPattern } from './codes';
import { PROP_RUNS } from './test-support';

const COMMAND_CODES = Object.keys(COMMAND_TABLE);
const CHARACTER_CODES = SUPPORTED_CHARACTERS.map((char) => CHARACTER_TABLE[char] ?? '');

const patternArb = fc.oneof(
  fc.array(fc.constantFrom('.', '-'), { minLength: 0, maxLength: 12 }).map((symbols) => symbols.join('')),
  fc.constantFrom(...CHARACTER_CODES, ...COMMAND_CODES),
);

describe('codes properties', () => {
  it('keeps the tables injective and command codes apart from character codes', () => {
    // Feature: morse-engine, Property 1: Tables are injective and commands never collide with characters
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_CHARACTERS),
        fc.constantFrom(...SUPPORTED_CHARACTERS),
        fc.constantFrom(...COMMAND_CODES),
        fc.constantFrom(...SUPPORTED_CHARACTERS),
        patternArb,
        (a, b, commandCode, x, pattern) => {
          if (a !== b && CHARACTER_TABLE[a] === CHARACTER_TABLE[b]) return false;
          if (commandCode === CHARACTER_TABLE[x]) return false;
          if (Object.hasOwn(CHARACTER_TABLE, '+')) return false;

          const found = lookupPattern(pattern);
          if (Object.hasOwn(COMMAND_TABLE, pattern)) {
            return found.kind === 'command' && found.command === COMMAND_TABLE[pattern];
          }
          const owner = SUPPORTED_CHARACTERS.find((char) => CHARACTER_TABLE[char] === pattern);
          if (owner !== undefined) {
            return found.kind === 'char' && found.char === owner;
          }
          return found.kind === 'unknown' && found.pattern === pattern;
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
