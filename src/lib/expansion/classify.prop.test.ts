import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classify, type InputClassification } from './classify';
import { PHRASE_BANK } from './phrase-bank';
import { initialsOf } from './normalize';
import { normalizedTokens } from './normalize';
import { PROP_RUNS, letterArb, renderTokensArb, renderedTokensArb, tokenArb } from './test-support/arbitraries';
import { WORD_LIST } from './word-freq';

const KINDS = ['initials', 'partial', 'words', 'empty'];

/** The literal criteria list of Requirement 4, checked against WORD_LIST by linear scans. */
function refClassification(tokens: readonly string[]): { kind: InputClassification['kind']; initials?: string } {
  if (tokens.length === 0) return { kind: 'empty' };
  const only = tokens[0] ?? '';
  if (tokens.length === 1 && only.length >= 2 && only.length <= 12 && /^[a-z]+$/.test(only) && (!WORD_LIST.includes(only) || (only.length === 2 && PHRASE_BANK.some((p) => initialsOf(p.text) === only)))) {
    return { kind: 'initials', initials: only };
  }
  if (tokens.length >= 2 && tokens.join('').length <= 12 && tokens.every((token) => /^[a-z]+$/.test(token) && (token.length === 1 || (!WORD_LIST.includes(token) && (!WORD_LIST.some((word) => word.length > token.length && word.startsWith(token)) || PHRASE_BANK.some((p) => initialsOf(p.text) === tokens.join(''))))))) {
    return { kind: 'initials', initials: tokens.join('') };
  }
  const last = tokens[tokens.length - 1] ?? '';
  if (!WORD_LIST.includes(last) && WORD_LIST.some((word) => word.length > last.length && word.startsWith(last))) {
    return { kind: 'partial' };
  }
  return { kind: 'words' };
}

const fixedLengthTokensArb = (lengths: readonly number[]): fc.Arbitrary<string[]> =>
  fc.constantFrom(...lengths).chain((n) => fc.array(tokenArb, { minLength: n, maxLength: n }));

const ruleTableTokensArb: fc.Arbitrary<readonly string[]> = fc.oneof(
  fc.array(tokenArb, { maxLength: 15 }),
  fixedLengthTokensArb([1, 2, 12, 13]),
  fc
    .constantFrom(1, 2, 12, 13)
    .chain((n) => fc.string({ unit: letterArb, minLength: n, maxLength: n }))
    .map((token) => [token]),
  fc.constantFrom(2, 12, 13).chain((n) => fc.array(letterArb, { minLength: n, maxLength: n })),
  fc
    .tuple(fc.array(letterArb, { minLength: 12, maxLength: 12 }), fc.constantFrom('a', 'i', 'w', 'x', 'q'))
    .map(([letters, last]) => [...letters, last]),
);

describe('classifier properties', () => {
  it('is total and well-formed for any string', () => {
    // Feature: expansion, Property 4: The classifier is total and well-formed
    const inputArb = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 1000 }),
      renderedTokensArb.map(({ text }) => text),
    );
    fc.assert(
      fc.property(inputArb, (s) => {
        const copy = `${s}`;
        const result = classify(s);
        expect(KINDS).toContain(result.kind);
        expect(result.tokens).toStrictEqual(normalizedTokens(s));
        expect('initials' in result).toBe(result.kind === 'initials');
        expect(classify(s)).toStrictEqual(result);
        expect(s).toBe(copy);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('depends only on the Normalized_Tokens', () => {
    // Feature: expansion, Property 5: Classification depends only on the Normalized_Tokens
    const pairArb = fc
      .array(tokenArb, { maxLength: 15 })
      .chain((tokens) => fc.tuple(fc.constant(tokens), renderTokensArb(tokens), renderTokensArb(tokens)));
    fc.assert(
      fc.property(pairArb, ([tokens, r1, r2]) => {
        expect(normalizedTokens(r1)).toStrictEqual(tokens);
        expect(normalizedTokens(r2)).toStrictEqual(tokens);
        expect(classify(r1)).toStrictEqual(classify(r2));
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('follows the rule table', () => {
    // Feature: expansion, Property 6: Classification follows the rule table
    fc.assert(
      fc.property(ruleTableTokensArb, (tokens) => {
        const result = classify(tokens.join(' '));
        const ref = refClassification(tokens);
        expect(result.kind).toBe(ref.kind);
        if (result.kind === 'initials') expect(result.initials).toBe(ref.initials);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});

// Feature: expansion, review 20.1: pause placement preserves eligible initials.
it('recognises paused initials and exact two-letter phrase initials', () => {
  fc.assert(fc.property(fc.constantFrom('iwtgo', 'cihsw'), fc.integer({ min: 1, max: 4 }), (text, at) => {
    const paused = `${text.slice(0, at)} ${text.slice(at)}`;
    const tokens = normalizedTokens(paused);
    const eligible = tokens.every((t) => t.length === 1 || (!WORD_LIST.includes(t) && !WORD_LIST.some((w) => w.startsWith(t) && w.length > t.length)));
    if (eligible) expect(classify(paused)).toMatchObject({ kind: 'initials', initials: text });
  }), { numRuns: PROP_RUNS });
  for (const text of ['iw tgo', 'i wtgo', 'ci hsw']) expect(classify(text).kind).toBe('initials');
  for (const text of ['it', 'is', 'if', 'in', 'id', 'im']) expect(classify(text)).toMatchObject({ kind: 'initials', initials: text });
  for (const text of ['i want', 'water']) expect(classify(text).kind).toBe('words');
});
