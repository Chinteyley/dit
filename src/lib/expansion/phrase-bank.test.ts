import { describe, expect, it } from 'vitest';
import { initialsOf, normalizedTokens } from './normalize';
import { PHRASE_BANK, type PhraseCategory } from './phrase-bank';

const CATEGORIES: readonly PhraseCategory[] = ['needs', 'feelings', 'care', 'social', 'questions'];
const FIRST_PERSON = new Set(['i', 'im', 'ive', 'ill', 'id', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our']);

describe('PHRASE_BANK', () => {
  it('has at least 150 phrases and at least 20 in each category', () => {
    expect(PHRASE_BANK.length).toBeGreaterThanOrEqual(150);
    for (const category of CATEGORIES) {
      expect(PHRASE_BANK.filter((phrase) => phrase.category === category).length, category).toBeGreaterThanOrEqual(20);
    }
  });

  it('tags every phrase with one of the 5 categories', () => {
    for (const phrase of PHRASE_BANK) {
      expect(CATEGORIES).toContain(phrase.category);
      expect(Object.keys(phrase).sort()).toStrictEqual(['category', 'text']);
    }
  });

  it('holds only first-person phrases or questions to the partner', () => {
    for (const { text } of PHRASE_BANK) {
      const tokens = normalizedTokens(text);
      const firstPerson = tokens.some((token) => FIRST_PERSON.has(token));
      const askingYou = text.endsWith('?') && (tokens.includes('you') || tokens.includes('your'));
      expect(firstPerson || askingYou, text).toBe(true);
    }
  });

  it('holds only single-line phrases of 1 to 200 characters with no outer Whitespace', () => {
    for (const { text } of PHRASE_BANK) {
      expect(text.length, text).toBeGreaterThanOrEqual(1);
      expect(text.length, text).toBeLessThanOrEqual(200);
      expect(text, text).toBe(text.replace(/^[ \t\n\r]+|[ \t\n\r]+$/g, ''));
      expect(/[\t\n\r]/.test(text), text).toBe(false);
      expect(normalizedTokens(text).length, text).toBeGreaterThan(0);
    }
  });

  it('has no two phrases that are equal case-insensitively', () => {
    const keys = PHRASE_BANK.map((phrase) => phrase.text.toLowerCase());
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('puts "I want to go outside." first among the iwtgo phrases', () => {
    expect(PHRASE_BANK.find((phrase) => initialsOf(phrase.text) === 'iwtgo')?.text).toBe('I want to go outside.');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(PHRASE_BANK)).toBe(true);
  });
});
