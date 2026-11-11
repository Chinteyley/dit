import { PHRASE_INDEX, isKnownWord, isProperPrefixOfSomeWord } from './lexicon';
import { normalizedTokens } from './normalize';

export type InputClassification =
  | { readonly kind: 'initials'; readonly tokens: readonly string[]; readonly initials: string }
  | { readonly kind: 'partial'; readonly tokens: readonly string[] }
  | { readonly kind: 'words'; readonly tokens: readonly string[] }
  | { readonly kind: 'empty'; readonly tokens: readonly [] };

export type InputKind = InputClassification['kind'];

const LETTERS = /^[a-z]+$/;
const INITIALS_MIN = 2;
const INITIALS_MAX = 12;

/**
 * Classifies typed text from its Normalized_Tokens alone (Requirement 4). The rules are checked
 * in order and the first that holds wins:
 * 1. no tokens: empty;
 * 2. one unknown all-letter token of 2 to 12 letters, or exact two-letter phrase initials: initials;
 * 3. paused all-letter tokens without multi-letter words/prefixes, 2–12 letters total: initials;
 * 4. last token not a Known_Word but a Proper_Prefix of one: partial;
 * 5. otherwise: words.
 */
export function classify(text: string): InputClassification {
  const tokens = [...normalizedTokens(text)];
  const count = tokens.length;
  const first = tokens[0];
  const last = tokens[count - 1];
  if (first === undefined || last === undefined) return { kind: 'empty', tokens: [] };
  if (count === 1 && first.length >= INITIALS_MIN && first.length <= INITIALS_MAX && LETTERS.test(first) && (!isKnownWord(first) || (first.length === 2 && PHRASE_INDEX.some((phrase) => phrase.initials === first)))) {
    return { kind: 'initials', tokens, initials: first };
  }
  const joined = tokens.join('');
  if (count >= 2 && joined.length >= INITIALS_MIN && joined.length <= INITIALS_MAX &&
    tokens.every((token) => LETTERS.test(token) && (token.length === 1 || (!isKnownWord(token) && (!isProperPrefixOfSomeWord(token) || PHRASE_INDEX.some((phrase) => phrase.initials === joined)))))) {
    return { kind: 'initials', tokens, initials: tokens.join('') };
  }
  if (!isKnownWord(last) && isProperPrefixOfSomeWord(last)) return { kind: 'partial', tokens };
  return { kind: 'words', tokens };
}
