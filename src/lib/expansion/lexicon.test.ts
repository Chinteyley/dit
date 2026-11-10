import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('lexicon', () => {
  it('builds every table at import without a network request and leaves the data unchanged', async () => {
    const fetchSpy = vi.fn(() => {
      throw new Error('no network');
    });
    vi.stubGlobal('fetch', fetchSpy);
    vi.resetModules();
    const { WORD_LIST } = await import('./word-freq');
    const { PHRASE_BANK } = await import('./phrase-bank');
    const words = [...WORD_LIST];
    const phrases = PHRASE_BANK.map((phrase) => ({ ...phrase }));
    const lexicon = await import('./lexicon');

    expect(lexicon.KNOWN_WORDS.size).toBe(WORD_LIST.length);
    expect(lexicon.PROPER_PREFIXES.size).toBeGreaterThan(0);
    expect(lexicon.PHRASE_INDEX).toHaveLength(PHRASE_BANK.length);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(WORD_LIST).toStrictEqual(words);
    expect(PHRASE_BANK).toStrictEqual(phrases);
  });

  it('completes wa with Word_List entries in Word_List order', async () => {
    const { WORD_LIST } = await import('./word-freq');
    const { completionsOf } = await import('./lexicon');
    const completions = [...completionsOf('wa')];
    expect(completions.length).toBeGreaterThan(0);
    expect(completions).toStrictEqual(WORD_LIST.filter((word) => word.length > 2 && word.startsWith('wa')));
  });

  it('yields completions lazily', async () => {
    const { completionsOf } = await import('./lexicon');
    const iterator = completionsOf('s');
    const first = iterator.next();
    expect(first.done).toBe(false);
    expect(first.value).toMatch(/^s./);
  });

  it('indexes the phrase bank in Bank_Order with tokens, initials and Context_Words', async () => {
    const { PHRASE_INDEX } = await import('./lexicon');
    PHRASE_INDEX.forEach((entry, i) => expect(entry.index).toBe(i));
    const outside = PHRASE_INDEX.find((entry) => entry.text === 'I want to go outside.');
    expect(outside?.tokens).toStrictEqual(['i', 'want', 'to', 'go', 'outside']);
    expect(outside?.initials).toBe('iwtgo');
    expect([...(outside?.contextWords ?? [])]).toStrictEqual(['want', 'outside']);
  });

  it('answers Known_Word and Proper_Prefix lookups', async () => {
    const { isKnownWord, isProperPrefixOfSomeWord } = await import('./lexicon');
    expect(isKnownWord('water')).toBe(true);
    expect(isKnownWord('wa')).toBe(false);
    expect(isProperPrefixOfSomeWord('wa')).toBe(true);
    expect(isProperPrefixOfSomeWord('')).toBe(false);
    expect(isProperPrefixOfSomeWord('zzzzq')).toBe(false);
  });
});
