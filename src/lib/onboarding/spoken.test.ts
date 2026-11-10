import { describe, expect, it } from 'vitest';
import { CHARACTER_TABLE, unitToWpm } from '@/lib/morse';
import { PUNCTUATION_NAMES, characterName, speedText, spokenCode } from './spoken';

describe('spokenCode', () => {
  it('reads each symbol as dot or dash, in order', () => {
    expect(spokenCode('.-.-.')).toBe('dot dash dot dash dot');
    expect(spokenCode('...---...')).toBe('dot dot dot dash dash dash dot dot dot');
    expect(spokenCode('-')).toBe('dash');
  });

  it('gives an empty text for an empty code and skips other characters', () => {
    expect(spokenCode('')).toBe('');
    expect(spokenCode('. -')).toBe('dot dash');
  });
});

describe('PUNCTUATION_NAMES', () => {
  const punctuation = Object.keys(CHARACTER_TABLE).filter((ch) => !/^[a-z0-9]$/.test(ch));

  it('has 13 unique names, one for every punctuation key of the Character_Table', () => {
    expect(punctuation).toHaveLength(13);
    expect(Object.keys(PUNCTUATION_NAMES).sort()).toEqual([...punctuation].sort());
    const names = Object.values(PUNCTUATION_NAMES);
    expect(names).toHaveLength(13);
    expect(new Set(names).size).toBe(13);
  });

  it('names a period, a question mark and a quotation mark in words', () => {
    expect(PUNCTUATION_NAMES['.']).toBe('period');
    expect(PUNCTUATION_NAMES['?']).toBe('question mark');
    expect(PUNCTUATION_NAMES['"']).toBe('quotation mark');
  });
});

describe('characterName', () => {
  it('uppercases letters, keeps digits and names punctuation', () => {
    expect(characterName('a')).toBe('A');
    expect(characterName('z')).toBe('Z');
    expect(characterName('7')).toBe('7');
    expect(characterName('@')).toBe('at sign');
    expect(characterName("'")).toBe('apostrophe');
  });

  it('returns other characters unchanged and ignores inherited object keys', () => {
    expect(characterName('+')).toBe('+');
    expect(characterName('toString')).toBe('toString');
  });
});

describe('speedText', () => {
  it('rounds unitToWpm(dot) to the nearest whole number', () => {
    expect(unitToWpm(200)).toBe(6);
    expect(speedText(200)).toBe('about 6 words per minute');
    expect(speedText(218)).toBe('about 6 words per minute'); // 5.50…
    expect(speedText(222)).toBe('about 5 words per minute'); // 5.40…
    expect(speedText(160)).toBe('about 8 words per minute'); // exactly 7.5 rounds up
    expect(speedText(60)).toBe('about 20 words per minute');
  });

  it('never says fewer than 1 word per minute', () => {
    expect(speedText(1000)).toBe('about 1 words per minute'); // 1.2
    expect(speedText(1500)).toBe('about 1 words per minute'); // 0.8, the slowest calibrated dot
    expect(speedText(3000)).toBe('about 1 words per minute'); // 0.4 rounds to 0, minimum 1
    expect(speedText(60_000)).toBe('about 1 words per minute');
  });
});
