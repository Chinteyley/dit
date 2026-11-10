import { isKnownWord, isProperPrefixOfSomeWord } from './lexicon';
import { normalizedTokens } from './normalize';

export type InputClassification =
  | { readonly kind: 'initials'; readonly tokens: readonly string[]; readonly initials: string }
  | { readonly kind: 'partial'; readonly tokens: readonly string[] }
  | { readonly kind: 'words'; readonly tokens: readonly string[] }
  | { readonly kind: 'empty'; readonly tokens: readonly [] };

export type InputKind = InputClassification['kind'];

const LETTERS = /^[a-z]+$/;
const ONE_LETTER = /^[a-z]$/;
const INITIALS_MIN = 2;
const INITIALS_MAX = 12;

/**
 * Classifies typed text from its Normalized_Tokens alone (Requirement 4). The rules are checked
 * in order and the first that holds wins:
 * 1. no tokens: empty;
 * 2. one all-letter token of 2 to 12 letters that is not a Known_Word: initials;
 * 3. 2 to 12 tokens, each a single letter: initials (the letters joined);
 * 4. last token not a Known_Word but a Proper_Prefix of one: partial;
 * 5. otherwise: words.
 */
export function classify(text: string): InputClassification {
  const tokens = [...normalizedTokens(text)];
  const count = tokens.length;
  const first = tokens[0];
  const last = tokens[count - 1];
  if (first === undefined || last === undefined) return { kind: 'empty', tokens: [] };
  if (count === 1 && first.length >= INITIALS_MIN && first.length <= INITIALS_MAX && LETTERS.test(first) && !isKnownWord(first)) {
    return { kind: 'initials', tokens, initials: first };
  }
  if (count >= INITIALS_MIN && count <= INITIALS_MAX && tokens.every((token) => ONE_LETTER.test(token))) {
    return { kind: 'initials', tokens, initials: tokens.join('') };
  }
  if (!isKnownWord(last) && isProperPrefixOfSomeWord(last)) return { kind: 'partial', tokens };
  return { kind: 'words', tokens };
}
