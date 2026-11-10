import { describe, expect, it } from 'vitest';
import { normalizedTokens } from './normalize';
import { PHRASE_BANK } from './phrase-bank';
import { WORD_LIST } from './word-freq';

/** Everyday two-letter words the list may hold; other two-letter fragments stay out. */
const EVERYDAY_TWO_LETTER = new Set([
  'am', 'an', 'as', 'at', 'be', 'by', 'do', 'go', 'he', 'hi', 'id', 'if', 'im', 'in', 'is', 'it',
  'me', 'my', 'no', 'of', 'oh', 'ok', 'on', 'or', 'ow', 'so', 'to', 'tv', 'up', 'us', 'we',
]);

describe('WORD_LIST', () => {
  it('has at least 1,000 entries made only of the letters a to z', () => {
    expect(WORD_LIST.length).toBeGreaterThanOrEqual(1000);
    for (const word of WORD_LIST) expect(word).toMatch(/^[a-z]+$/);
  });

  it('has no duplicates', () => {
    expect(new Set(WORD_LIST).size).toBe(WORD_LIST.length);
  });

  it('holds i and a, and no other single letters', () => {
    expect(WORD_LIST).toContain('i');
    expect(WORD_LIST).toContain('a');
    expect(WORD_LIST.filter((word) => word.length === 1).sort()).toStrictEqual(['a', 'i']);
  });

  it('keeps wa and iwtgo unknown while wa is a Proper_Prefix of some entry', () => {
    expect(WORD_LIST).not.toContain('wa');
    expect(WORD_LIST).not.toContain('iwtgo');
    expect(WORD_LIST.some((word) => word.length > 2 && word.startsWith('wa'))).toBe(true);
  });

  it('holds only everyday two-letter words', () => {
    for (const word of WORD_LIST.filter((entry) => entry.length === 2)) expect(EVERYDAY_TWO_LETTER).toContain(word);
  });

  it('holds every everyday word the phrase bank uses', () => {
    const known = new Set(WORD_LIST);
    const phraseWords = new Set(PHRASE_BANK.flatMap((phrase) => normalizedTokens(phrase.text)));
    for (const word of phraseWords) expect(known.has(word), word).toBe(true);
    for (const word of ['water', 'outside', 'pain', 'nurse']) expect(known.has(word), word).toBe(true);
  });

  it('starts with the most frequent words', () => {
    expect(WORD_LIST.slice(0, 3)).toStrictEqual(['the', 'of', 'and']);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(WORD_LIST)).toBe(true);
  });
});
