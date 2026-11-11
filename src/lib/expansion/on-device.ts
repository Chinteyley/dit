import { classify } from './classify';
import { PHRASE_INDEX, completionsOf, contextWordsOf, type PhraseEntry } from './lexicon';
import { suggestionKey } from './normalize';
import { isValidSuggestionText, type Turn } from './schema';

/** The most suggestions the on-device expander returns. */
export const ON_DEVICE_MAX = 3;

const NO_WORDS: ReadonlySet<string> = new Set();

/** Context_Words of the latest partner Turn, or none when the context has no partner Turn. */
function partnerWords(context: readonly Turn[]): ReadonlySet<string> {
  for (let i = context.length - 1; i >= 0; i -= 1) {
    const turn = context[i];
    if (turn?.role === 'partner' && typeof turn.text === 'string') return contextWordsOf(turn.text);
  }
  return NO_WORDS;
}

function scoreAgainst(entry: PhraseEntry, words: ReadonlySet<string>): number {
  let score = 0;
  for (const word of entry.contextWords) {
    if (words.has(word)) score += 1;
  }
  return score;
}

/** Distinct Context_Words of the latest partner Turn that also appear in the phrase (Context_Score). */
export function contextScore(entry: PhraseEntry, context: readonly Turn[]): number {
  return scoreAgainst(entry, partnerWords(context));
}

/** Context_Score from highest to lowest, then Bank_Order from lowest to highest. Sorts a copy. */
function rank(entries: readonly PhraseEntry[], words: ReadonlySet<string>): PhraseEntry[] {
  return entries
    .map((entry) => ({ entry, score: scoreAgainst(entry, words) }))
    .sort((a, b) => b.score - a.score || a.entry.index - b.entry.index)
    .map(({ entry }) => entry);
}

/** The first `max` candidates that are valid suggestions and not case-insensitive repeats. */
function takeValid(candidates: Iterable<string>, max: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (out.length >= max) break;
    const key = suggestionKey(candidate);
    if (!isValidSuggestionText(candidate) || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

function* partialCandidates(tokens: readonly string[]): Generator<string, void, undefined> {
  const last = tokens[tokens.length - 1];
  if (last === undefined) return;
  const lead = tokens.slice(0, -1);
  for (const word of completionsOf(last)) yield [...lead, word].join(' ');
}

function startsWithTokens(entry: PhraseEntry, tokens: readonly string[]): boolean {
  return entry.tokens.length > tokens.length && tokens.every((token, i) => entry.tokens[i] === token);
}

/**
 * Expands typed text into 0 to 3 suggestions with no network (Requirements 6 to 8): initials
 * from the phrase bank (exact tier, then prefix tier), a partial last word from the word list,
 * or complete words continued from the phrase bank. Pure and deterministic.
 */
export function expandOnDevice(text: string, context: readonly Turn[]): string[] {
  const cls = classify(text);
  switch (cls.kind) {
    case 'empty':
      return [];
    case 'initials': {
      const words = partnerWords(context);
      const letters = cls.initials;
      const exact = PHRASE_INDEX.filter((entry) => entry.initials === letters);
      const prefix = PHRASE_INDEX.filter((entry) => entry.initials.length > letters.length && entry.initials.startsWith(letters));
      return takeValid(
        [...rank(exact, words), ...rank(prefix, words)].map((entry) => entry.text),
        ON_DEVICE_MAX,
      );
    }
    case 'partial':
      return takeValid(partialCandidates(cls.tokens), ON_DEVICE_MAX);
    case 'words': {
      const words = partnerWords(context);
      const matches = PHRASE_INDEX.filter((entry) => startsWithTokens(entry, cls.tokens));
      return takeValid(
        rank(matches, words).map((entry) => entry.text),
        ON_DEVICE_MAX,
      );
    }
  }
}
