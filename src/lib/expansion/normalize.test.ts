import { describe, expect, it } from 'vitest';
import { WHITESPACE, initialsOf, isWhitespace, normalizedTokens, suggestionKey, trimWhitespace } from './normalize';

describe('normalizedTokens', () => {
  it('lowercases, drops punctuation and splits on Whitespace', () => {
    expect(normalizedTokens('I want, WA!')).toStrictEqual(['i', 'want', 'wa']);
  });

  it('joins a contraction into one token', () => {
    expect(normalizedTokens("don't")).toStrictEqual(['dont']);
  });

  it('splits on every Whitespace character and drops empty tokens', () => {
    expect(normalizedTokens(' \t i\n\r w  t ')).toStrictEqual(['i', 'w', 't']);
  });

  it('keeps digits and removes non-ASCII letters', () => {
    expect(normalizedTokens('room 12 é')).toStrictEqual(['room', '12']);
  });

  it('keeps a character whose lowercase form is ASCII', () => {
    expect(normalizedTokens('\u212Aind')).toStrictEqual(['kind']);
  });

  it('returns no tokens for empty, Whitespace-only and punctuation-only text', () => {
    expect(normalizedTokens('')).toStrictEqual([]);
    expect(normalizedTokens(' \t\n\r')).toStrictEqual([]);
    expect(normalizedTokens('?!')).toStrictEqual([]);
  });

  it('does not split on Whitespace look-alikes, which it removes instead', () => {
    expect(normalizedTokens('a\u00A0b')).toStrictEqual(['ab']);
  });
});

describe('initialsOf', () => {
  it('takes the first character of each token', () => {
    expect(initialsOf('I want to go outside.')).toBe('iwtgo');
    expect(initialsOf("I'm cold")).toBe('ic');
  });

  it('is empty when there are no tokens', () => {
    expect(initialsOf('?!')).toBe('');
  });
});

describe('trimWhitespace', () => {
  it('removes only the 4 Whitespace characters at both ends', () => {
    expect(trimWhitespace('  i want wa \n')).toBe('i want wa');
    expect(trimWhitespace('\t\r\n x y \r\n\t')).toBe('x y');
  });

  it('keeps U+00A0, U+2028 and U+FEFF', () => {
    expect(trimWhitespace('\u00A0hi\u00A0')).toBe('\u00A0hi\u00A0');
    expect(trimWhitespace(' \u2028hi\uFEFF ')).toBe('\u2028hi\uFEFF');
  });

  it('leaves inner Whitespace unchanged and handles empty and all-Whitespace strings', () => {
    expect(trimWhitespace(' a \t b ')).toBe('a \t b');
    expect(trimWhitespace('')).toBe('');
    expect(trimWhitespace(' \t\n\r ')).toBe('');
  });
});

describe('isWhitespace and WHITESPACE', () => {
  it('has exactly space, tab, line feed and carriage return', () => {
    expect([...WHITESPACE].sort()).toStrictEqual(['\t', '\n', '\r', ' ']);
    expect(isWhitespace(' ')).toBe(true);
    expect(isWhitespace('\u00A0')).toBe(false);
    expect(isWhitespace('\u3000')).toBe(false);
  });
});

describe('suggestionKey', () => {
  it('compares case-insensitively', () => {
    expect(suggestionKey('Yes')).toBe(suggestionKey('yES'));
    expect(suggestionKey('Yes')).not.toBe(suggestionKey('Yes.'));
  });
});
