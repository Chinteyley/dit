import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { classify } from './classify';
import { PHRASE_INDEX } from './lexicon';
import { initialsOf, normalizedTokens } from './normalize';
import { expandOnDevice } from './on-device';
import { PHRASE_BANK } from './phrase-bank';
import { ExpandResponseSchema, type Turn } from './schema';
import {
  PHRASE_CONTEXT_WORDS,
  PROP_RUNS,
  contextArb,
  initialsLettersArb,
  knownWordArb,
  renderTokensArb,
  renderedTokensArb,
  tokenArb,
  turnArb,
  turnTextArb,
  unknownProperPrefixArb,
} from './test-support/arbitraries';
import { WORD_LIST } from './word-freq';

const throwingFetch = vi.fn(() => {
  throw new Error('no network');
});

beforeEach(() => {
  throwingFetch.mockClear();
  vi.stubGlobal('fetch', throwingFetch);
});

afterEach(() => {
  expect(throwingFetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Independent reference model, built from PHRASE_BANK and WORD_LIST directly

function refPartnerWords(context: readonly Turn[]): Set<string> {
  const partner = [...context].reverse().find((turn) => turn.role === 'partner');
  return new Set(partner === undefined ? [] : normalizedTokens(partner.text).filter((token) => token.length >= 3));
}

function refScore(text: string, partnerWords: ReadonlySet<string>): number {
  return new Set(normalizedTokens(text).filter((token) => token.length >= 3 && partnerWords.has(token))).size;
}

interface Ranked {
  readonly text: string;
  readonly index: number;
  readonly score: number;
}

function refRank(texts: readonly { text: string; index: number }[], context: readonly Turn[]): Ranked[] {
  const words = refPartnerWords(context);
  return texts
    .map(({ text, index }) => ({ text, index, score: refScore(text, words) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function refTake(candidates: Iterable<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates) {
    if (out.length === 3) break;
    const key = candidate.toLowerCase();
    if (candidate.length < 1 || candidate.length > 200 || seen.has(key)) continue;
    seen.add(key);
    out.push(candidate);
  }
  return out;
}

const bank = PHRASE_BANK.map((phrase, index) => ({ text: phrase.text, index }));

function refInitials(letters: string, context: readonly Turn[]): string[] {
  const exact = bank.filter(({ text }) => initialsOf(text) === letters);
  const prefix = bank.filter(({ text }) => initialsOf(text).length > letters.length && initialsOf(text).startsWith(letters));
  return refTake([...refRank(exact, context), ...refRank(prefix, context)].map(({ text }) => text));
}

function refWords(tokens: readonly string[], context: readonly Turn[]): string[] {
  const matches = bank.filter(({ text }) => {
    const phraseTokens = normalizedTokens(text);
    return phraseTokens.length > tokens.length && tokens.every((token, i) => phraseTokens[i] === token);
  });
  return refTake(refRank(matches, context).map(({ text }) => text));
}

function refPartial(tokens: readonly string[]): string[] {
  const last = tokens[tokens.length - 1] ?? '';
  const lead = tokens.slice(0, -1);
  return refTake(
    WORD_LIST.filter((word) => word.length > last.length && word.startsWith(last)).map((word) => [...lead, word].join(' ')),
  );
}

// ---------------------------------------------------------------------------
// Generators

/** Leading text of about `length` characters made of Known_Words. */
const longLeadArb = (min: number, max: number): fc.Arbitrary<string[]> =>
  fc
    .tuple(fc.integer({ min, max }), fc.array(knownWordArb, { minLength: 80, maxLength: 80 }))
    .map(([length, words]) => {
      const lead: string[] = [];
      let size = 0;
      for (const word of words) {
        if (size >= length) break;
        lead.push(word);
        size += word.length + 1;
      }
      return lead;
    });

/** Texts of 150 to 300 characters that end in a Proper_Prefix (long 'partial' joins). */
const longPartialTextArb = fc
  .tuple(longLeadArb(140, 280), unknownProperPrefixArb)
  .map(([lead, prefix]) => `${lead.join(' ')} ${prefix}`);

/** Contexts whose latest partner Turn shares 0 to 3 Context_Words with the phrases matching `letters`. */
function sharedContextArb(letters: string): fc.Arbitrary<Turn[]> {
  const matching = PHRASE_INDEX.filter((entry) => entry.initials.startsWith(letters));
  const words = [...new Set(matching.flatMap((entry) => [...entry.contextWords]))];
  const sharedArb = words.length > 0 ? fc.subarray(words, { maxLength: Math.min(3, words.length) }) : fc.constant<string[]>([]);
  const partnerArb = fc
    .tuple(sharedArb, fc.array(fc.constantFrom(...PHRASE_CONTEXT_WORDS), { maxLength: 3 }))
    .chain(([shared, filler]) => renderTokensArb(shared.length + filler.length > 0 ? [...shared, ...filler] : ['hello']));
  const speakerTurnArb = turnTextArb.map((text): Turn => ({ role: 'speaker', text }));
  return fc.oneof(
    contextArb,
    fc
      .tuple(fc.array(turnArb, { maxLength: 4 }), partnerArb, fc.array(speakerTurnArb, { maxLength: 3 }))
      .map(([before, text, after]) => [...before, { role: 'partner' as const, text }, ...after]),
  );
}

/** Initials inputs: one unknown token, or spaced single letters, rendered with noise. */
const initialsInputArb = initialsLettersArb.chain((letters) =>
  fc
    .tuple(
      WORD_LIST.includes(letters) ? renderTokensArb(letters.split('')) : fc.oneof(renderTokensArb([letters]), renderTokensArb(letters.split(''))),
      sharedContextArb(letters),
    )
    .map(([text, context]) => ({ letters, text, context })),
);

describe('on-device expander properties', () => {
  it('always returns a valid, repeatable list and leaves its inputs unchanged', () => {
    // Feature: expansion, Property 7: On-device output is always valid, repeatable and non-mutating
    const textArb = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 300 }),
      renderedTokensArb.map(({ text }) => text),
      longPartialTextArb,
      initialsInputArb.map(({ text }) => text),
    );
    fc.assert(
      fc.property(textArb, contextArb, (text, context) => {
        const before = structuredClone({ text, context });
        const first = expandOnDevice(text, context);
        expect(ExpandResponseSchema.safeParse({ suggestions: first }).success).toBe(true);
        expect(first.length).toBeLessThanOrEqual(3);
        const again = expandOnDevice(structuredClone(text), structuredClone(context));
        expect(again).toStrictEqual(first);
        expect({ text, context }).toStrictEqual(before);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('ranks initials suggestions by tier, then Context_Score, then Bank_Order', () => {
    // Feature: expansion, Property 8: Initials suggestions follow the tier ranking
    fc.assert(
      fc.property(initialsInputArb, ({ letters, text, context }) => {
        const cls = classify(text);
        expect(cls.kind === 'initials' && cls.initials).toBe(letters);
        const result = expandOnDevice(text, context);
        expect(result).toStrictEqual(refInitials(letters, context));
        let seenPrefixTier = false;
        for (const suggestion of result) {
          const initials = initialsOf(suggestion);
          expect(initials.startsWith(letters)).toBe(true);
          if (initials.length > letters.length) seenPrefixTier = true;
          else expect(seenPrefixTier).toBe(false);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('gives the same initials output however the letters were typed', () => {
    // Feature: expansion, Property 9: Initials output ignores how the letters were typed
    const caseArb = initialsLettersArb
      .filter((letters) => !WORD_LIST.includes(letters))
      .chain((letters) =>
        fc.tuple(
          fc.constant(letters),
          renderTokensArb([letters]),
          renderTokensArb(letters.split('')),
          contextArb,
        ),
      );
    fc.assert(
      fc.property(caseArb, ([letters, oneToken, spaced, context]) => {
        const expected = expandOnDevice(letters, context);
        expect(expandOnDevice(letters.toUpperCase(), context)).toStrictEqual(expected);
        expect(expandOnDevice(letters.split('').join(' '), context)).toStrictEqual(expected);
        expect(expandOnDevice(oneToken, context)).toStrictEqual(expected);
        expect(expandOnDevice(spaced, context)).toStrictEqual(expected);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('completes a partial last word in Word_List order, whatever the context', () => {
    // Feature: expansion, Property 10: Partial completions follow Word_List order
    const leadArb = fc.oneof(
      { weight: 3, arbitrary: fc.array(tokenArb, { maxLength: 5 }) },
      { weight: 1, arbitrary: longLeadArb(150, 220) },
    );
    const caseArb = fc
      .tuple(leadArb, unknownProperPrefixArb)
      .map(([lead, last]) => [...lead, last])
      .filter((tokens) => classify(tokens.join(' ')).kind === 'partial')
      .chain((tokens) => fc.tuple(fc.constant(tokens), renderTokensArb(tokens), contextArb, contextArb));
    fc.assert(
      fc.property(caseArb, ([tokens, text, ctx1, ctx2]) => {
        const result = expandOnDevice(text, ctx1);
        expect(result).toStrictEqual(refPartial(tokens));
        expect(expandOnDevice(text, ctx2)).toStrictEqual(result);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('continues complete words with phrase-bank phrases ranked by context', () => {
    // Feature: expansion, Property 11: Word continuations are phrase-bank prefixes ranked by context
    const fromPhraseArb = fc
      .constantFrom(...PHRASE_INDEX)
      .chain((entry) => fc.integer({ min: 1, max: entry.tokens.length }).map((k) => ({ entry, tokens: entry.tokens.slice(0, k) })));
    const shuffledArb = fc
      .constantFrom(...PHRASE_INDEX.filter((entry) => entry.tokens.length >= 2))
      .chain((entry) => fc.shuffledSubarray([...entry.tokens], { minLength: 1 }).map((tokens) => ({ entry: undefined, tokens })));
    const randomArb = fc.array(tokenArb, { minLength: 1, maxLength: 6 }).map((tokens) => ({ entry: undefined, tokens }));
    const caseArb = fc
      .oneof({ weight: 3, arbitrary: fromPhraseArb }, { weight: 1, arbitrary: shuffledArb }, { weight: 1, arbitrary: randomArb })
      .filter(({ tokens }) => classify(tokens.join(' ')).kind === 'words')
      .chain((c) => fc.tuple(fc.constant(c), renderTokensArb(c.tokens), sharedContextArb(c.tokens.map((t) => t.charAt(0)).join(''))));
    fc.assert(
      fc.property(caseArb, ([{ entry, tokens }, text, context]) => {
        const result = expandOnDevice(text, context);
        expect(result).toStrictEqual(refWords(tokens, context));
        if (entry !== undefined && tokens.length === entry.tokens.length) expect(result).not.toContain(entry.text);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
