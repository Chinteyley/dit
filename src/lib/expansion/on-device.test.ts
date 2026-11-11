import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PHRASE_INDEX } from './lexicon';
import { initialsOf, normalizedTokens } from './normalize';
import { ON_DEVICE_MAX, contextScore, expandOnDevice } from './on-device';
import type { Turn } from './schema';
import { WORD_LIST } from './word-freq';

const fetchSpy = vi.fn(() => {
  throw new Error('no network');
});

beforeEach(() => {
  fetchSpy.mockClear();
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  expect(fetchSpy).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

const partner = (text: string): Turn => ({ role: 'partner', text });
const speaker = (text: string): Turn => ({ role: 'speaker', text });

describe('expandOnDevice with initials', () => {
  it('puts "I want to go outside." first for iwtgo and i w t g o', () => {
    expect(expandOnDevice('iwtgo', [])[0]).toBe('I want to go outside.');
    expect(expandOnDevice('i w t g o', [])[0]).toBe('I want to go outside.');
    expect(expandOnDevice('iwt go', [])[0]).toBe('I want to go outside.');
    expect(expandOnDevice('iw th', [])).toEqual(expandOnDevice('iwth', []));
    expect(expandOnDevice('I.W.T.G.O!', [])[0]).toBe('I want to go outside.');
  });

  it('returns prefix-tier matches when no phrase has exactly those initials', () => {
    const exact = new Set(PHRASE_INDEX.map((entry) => entry.initials));
    const letters = PHRASE_INDEX.flatMap((entry) =>
      Array.from({ length: entry.initials.length - 2 }, (_, k) => entry.initials.slice(0, k + 2)),
    ).find((prefix) => !exact.has(prefix) && !WORD_LIST.includes(prefix));
    expect(letters).toBeDefined();
    const suggestions = expandOnDevice(letters ?? '', []);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.length).toBeLessThanOrEqual(ON_DEVICE_MAX);
    for (const suggestion of suggestions) {
      const initials = initialsOf(suggestion);
      expect(initials.length).toBeGreaterThan(letters?.length ?? 0);
      expect(initials.startsWith(letters ?? '')).toBe(true);
    }
  });

  it('orders a tier by Bank_Order, and by the latest partner line when it shares a Context_Word', () => {
    const a = 'I want to go outside.';
    const b = 'I want to go out.';
    const plain = expandOnDevice('iwtgo', []);
    expect(plain.indexOf(a)).toBeLessThan(plain.indexOf(b));
    const replying = expandOnDevice('iwtgo', [partner('Shall we go out now?')]);
    expect(replying.indexOf(b)).toBeGreaterThanOrEqual(0);
    expect(replying.indexOf(b)).toBeLessThan(replying.indexOf(a));
  });

  it('scores only the latest partner Turn', () => {
    const out = PHRASE_INDEX.find((entry) => entry.text === 'I want to go out.');
    expect(out).toBeDefined();
    if (out === undefined) return;
    expect(contextScore(out, [])).toBe(0);
    expect(contextScore(out, [speaker('want out')])).toBe(0);
    expect(contextScore(out, [partner('Do you want to go out?'), speaker('hi')])).toBe(2);
    expect(contextScore(out, [partner('Do you want to go out?'), partner('Hello')])).toBe(0);
  });

  it('returns an empty list when no phrase matches the initials', () => {
    expect(expandOnDevice('qzx', [])).toStrictEqual([]);
  });
});

describe('expandOnDevice with a partial last word', () => {
  it('completes i want wa from the word list', () => {
    const suggestions = expandOnDevice('i want wa', []);
    expect(suggestions.length).toBeGreaterThanOrEqual(1);
    expect(suggestions.length).toBeLessThanOrEqual(ON_DEVICE_MAX);
    for (const suggestion of suggestions) {
      const tokens = normalizedTokens(suggestion);
      expect(tokens).toHaveLength(3);
      expect(suggestion.startsWith('i want wa')).toBe(true);
      const last = tokens[2] ?? '';
      expect(WORD_LIST).toContain(last);
      expect(last.length).toBeGreaterThan(2);
    }
    expect(suggestions).toStrictEqual(
      WORD_LIST.filter((word) => word.length > 2 && word.startsWith('wa'))
        .slice(0, 3)
        .map((word) => `i want ${word}`),
    );
  });

  it('ignores the context and adds no capitals or punctuation', () => {
    expect(expandOnDevice('I want, WA!', [partner('Water?')])).toStrictEqual(expandOnDevice('i want wa', []));
  });

  it('drops completions longer than 200 characters', () => {
    const lead = Array.from({ length: 40 }, () => 'water').join(' ');
    expect(expandOnDevice(`${lead} wa`, [])).toStrictEqual([]);
  });
});

describe('expandOnDevice with complete words', () => {
  it('continues the typed words from the phrase bank in Bank_Order', () => {
    const suggestions = expandOnDevice('i want', []);
    expect(suggestions).toStrictEqual(
      PHRASE_INDEX.filter((entry) => entry.tokens.length > 2 && entry.tokens[0] === 'i' && entry.tokens[1] === 'want')
        .slice(0, 3)
        .map((entry) => entry.text),
    );
  });

  it('needs the words in the typed order and more tokens than typed', () => {
    expect(expandOnDevice('want i', [])).toStrictEqual([]);
    expect(expandOnDevice('i need help', [])).not.toContain('I need help.');
  });
});

describe('expandOnDevice with no tokens', () => {
  it('returns an empty list', () => {
    expect(expandOnDevice('?!', [])).toStrictEqual([]);
    expect(expandOnDevice('', [])).toStrictEqual([]);
    expect(expandOnDevice(' \t ', [])).toStrictEqual([]);
  });
});
