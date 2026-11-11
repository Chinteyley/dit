/**
 * Lookup tables derived once, at import, from the bundled word list and phrase bank, so the
 * classifier and the on-device expander share one copy. Pure: the data is never mutated.
 */
import { initialsOf, normalizedTokens } from './normalize';
import { PHRASE_BANK } from './phrase-bank';
import { WORD_LIST } from './word-freq';

/** Tokens of 3 or more characters count as Context_Words. */
export const CONTEXT_WORD_MIN = 3;

export const KNOWN_WORDS: ReadonlySet<string> = new Set(WORD_LIST);

/** Every `w.slice(0, k)` for 1 <= k < w.length, over the word list. */
export const PROPER_PREFIXES: ReadonlySet<string> = (() => {
  const prefixes = new Set<string>();
  for (const word of WORD_LIST) {
    for (let k = 1; k < word.length; k += 1) prefixes.add(word.slice(0, k));
  }
  return prefixes;
})();

export interface PhraseEntry {
  /** Bank_Order. */
  readonly index: number;
  /** The exact phrase text. */
  readonly text: string;
  /** Normalized_Tokens of the text. */
  readonly tokens: readonly string[];
  /** Initials_Of the text. */
  readonly initials: string;
  /** Tokens of 3 or more characters. */
  readonly contextWords: ReadonlySet<string>;
}

/** The Context_Words of a text: its Normalized_Tokens of 3 or more characters. */
export function contextWordsOf(text: string): ReadonlySet<string> {
  return new Set(normalizedTokens(text).filter((token) => token.length >= CONTEXT_WORD_MIN));
}

export const PHRASE_INDEX: readonly PhraseEntry[] = Object.freeze(
  PHRASE_BANK.map(
    (phrase, index): PhraseEntry =>
      Object.freeze({
        index,
        text: phrase.text,
        tokens: Object.freeze([...normalizedTokens(phrase.text)]),
        initials: initialsOf(phrase.text),
        contextWords: contextWordsOf(phrase.text),
      }),
  ),
);

export function isKnownWord(token: string): boolean {
  return KNOWN_WORDS.has(token);
}

export function isProperPrefixOfSomeWord(token: string): boolean {
  return PROPER_PREFIXES.has(token);
}

/** Word_List entries that have `token` as a Proper_Prefix, lazily, in Word_List order. */
export function* completionsOf(token: string): Generator<string, void, undefined> {
  for (const word of WORD_LIST) {
    if (word.length > token.length && word.startsWith(token)) yield word;
  }
}
