import { describe, expect, it } from 'vitest';
import {
  CHARACTER_TABLE,
  CODE_TO_CHAR,
  COMMAND_TABLE,
  SUPPORTED_CHARACTERS,
  codeOf,
  lookupPattern,
} from './codes';

// Literal copies of Requirements 3.1, 3.2, 3.3 and 4.1.
const LETTERS: Readonly<Record<string, string>> = {
  a: '.-',
  b: '-...',
  c: '-.-.',
  d: '-..',
  e: '.',
  f: '..-.',
  g: '--.',
  h: '....',
  i: '..',
  j: '.---',
  k: '-.-',
  l: '.-..',
  m: '--',
  n: '-.',
  o: '---',
  p: '.--.',
  q: '--.-',
  r: '.-.',
  s: '...',
  t: '-',
  u: '..-',
  v: '...-',
  w: '.--',
  x: '-..-',
  y: '-.--',
  z: '--..',
};

const DIGITS: Readonly<Record<string, string>> = {
  '0': '-----',
  '1': '.----',
  '2': '..---',
  '3': '...--',
  '4': '....-',
  '5': '.....',
  '6': '-....',
  '7': '--...',
  '8': '---..',
  '9': '----.',
};

const PUNCTUATION: Readonly<Record<string, string>> = {
  '.': '.-.-.-',
  ',': '--..--',
  '?': '..--..',
  "'": '.----.',
  '!': '-.-.--',
  '/': '-..-.',
  '-': '-....-',
  '(': '-.--.',
  ')': '-.--.-',
  ':': '---...',
  '=': '-...-',
  '@': '.--.-.',
  '"': '.-..-.',
};

const COMMANDS: Readonly<Record<string, string>> = {
  '.-.-.': 'speak',
  '..--': 'next',
  '----': 'backspace',
  '...---...': 'sos',
};

describe('CHARACTER_TABLE', () => {
  it('matches the ITU letters, digits and punctuation exactly', () => {
    expect({ ...CHARACTER_TABLE }).toStrictEqual({ ...LETTERS, ...DIGITS, ...PUNCTUATION });
  });

  it('has exactly 49 entries and an injective reverse map', () => {
    expect(Object.keys(CHARACTER_TABLE)).toHaveLength(49);
    expect(CODE_TO_CHAR.size).toBe(49);
  });

  it('excludes + and every uppercase letter', () => {
    expect(Object.hasOwn(CHARACTER_TABLE, '+')).toBe(false);
    expect(Object.keys(CHARACTER_TABLE).filter((key) => /[A-Z]/.test(key))).toStrictEqual([]);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(CHARACTER_TABLE)).toBe(true);
    expect(Object.isFrozen(COMMAND_TABLE)).toBe(true);
    expect(Object.isFrozen(SUPPORTED_CHARACTERS)).toBe(true);
  });
});

describe('SUPPORTED_CHARACTERS', () => {
  it('lists letters, then digits, then punctuation in table order', () => {
    expect(SUPPORTED_CHARACTERS).toStrictEqual([
      ...Object.keys(LETTERS),
      ...Object.keys(DIGITS),
      ...Object.keys(PUNCTUATION),
    ]);
  });
});

describe('COMMAND_TABLE', () => {
  it('maps the four command codes and nothing else', () => {
    expect({ ...COMMAND_TABLE }).toStrictEqual(COMMANDS);
  });
});

describe('lookupPattern', () => {
  it('reads .-.-. as the speak command, never as +', () => {
    expect(lookupPattern('.-.-.')).toStrictEqual({ kind: 'command', command: 'speak' });
  });

  it('finds characters and reports unknown patterns verbatim', () => {
    expect(lookupPattern('.-')).toStrictEqual({ kind: 'char', char: 'a' });
    expect(lookupPattern('-----')).toStrictEqual({ kind: 'char', char: '0' });
    expect(lookupPattern('......')).toStrictEqual({ kind: 'unknown', pattern: '......' });
    expect(lookupPattern('')).toStrictEqual({ kind: 'unknown', pattern: '' });
  });
});

describe('codeOf', () => {
  it('returns codes for supported characters only', () => {
    expect(codeOf('e')).toBe('.');
    expect(codeOf('+')).toBeUndefined();
    expect(codeOf('E')).toBeUndefined();
    expect(codeOf('toString')).toBeUndefined();
  });
});
