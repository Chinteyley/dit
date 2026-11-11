import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classify, type InputClassification } from './classify';
import { filterSuggestions } from './filter';
import { initialsOf } from './normalize';
import { PHRASE_BANK } from './phrase-bank';
import { CANDIDATES_MAX, ExpandResponseSchema } from './schema';
import {
  PROP_RUNS,
  initialsLettersArb,
  letterArb,
  renderTokensArb,
  renderedTokensArb,
  textWithLenArb,
  wsArb,
} from './test-support/arbitraries';
import { WORD_LIST } from './word-freq';

/** The pipeline of Requirement 11 written out step by step, starting with the window of 11.9. */
function refFilter(list: readonly string[], cls: InputClassification): string[] {
  const head = list.slice(0, CANDIDATES_MAX);
  const trimmed = head.map((s) => s.replace(/^[ \t\n\r]+/, '').replace(/[ \t\n\r]+$/, ''));
  const sized = trimmed.filter((s) => s.length >= 1 && s.length <= 200);
  const matching = cls.kind === 'initials' ? sized.filter((s) => initialsOf(s) === cls.initials) : sized;
  const firsts: string[] = [];
  const keys = new Set<string>();
  for (const s of matching) {
    if (keys.has(s.toLowerCase())) continue;
    keys.add(s.toLowerCase());
    firsts.push(s);
  }
  return firsts.slice(0, 3);
}

const classificationArb: fc.Arbitrary<InputClassification> = fc.oneof(
  renderedTokensArb.map(({ text }) => classify(text)),
  initialsLettersArb.chain((letters) => fc.oneof(renderTokensArb([letters]), renderTokensArb(letters.split('')))).map(classify),
);

const wordsByLetter = new Map<string, string[]>();
for (const word of WORD_LIST) {
  const list = wordsByLetter.get(word.charAt(0)) ?? [];
  list.push(word);
  wordsByLetter.set(word.charAt(0), list);
}
const wordStartingWith = (letter: string): fc.Arbitrary<string> => {
  const words = wordsByLetter.get(letter);
  return words !== undefined && words.length > 0 ? fc.constantFrom(...words) : fc.constant(`${letter}xx`);
};

/** A sentence whose words start with `letters`, optionally with one initial changed. */
function initialsSentenceArb(letters: string): fc.Arbitrary<string> {
  return fc
    .tuple(fc.integer({ min: -1, max: letters.length - 1 }), letterArb)
    .chain(([wrongAt, replacement]) => {
      const initials = letters.split('').map((ch, i) => (i === wrongAt && replacement !== ch ? replacement : ch));
      return fc.tuple(...initials.map(wordStartingWith));
    })
    .chain((words) =>
      fc.tuple(fc.constant(words), wsArb, wsArb, fc.constantFrom('.', '!', '?', '')).map(([ws, lead, trail, mark]) => {
        const sentence = ws.join(' ');
        return `${lead}${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}${mark}${trail}`;
      }),
    );
}

/** Strings of exactly 200 or 201 units after trimming. */
const boundaryArb = fc
  .tuple(textWithLenArb(200, 201), wsArb, wsArb)
  .map(([core, lead, trail]) => `${lead}x${core.slice(1, -1)}y${trail}`);

function itemArb(cls: InputClassification): fc.Arbitrary<string> {
  const options: fc.Arbitrary<string>[] = [
    fc.string({ unit: 'binary', maxLength: 1000 }),
    fc.tuple(wsArb, fc.constantFrom(...PHRASE_BANK.map((p) => p.text)), wsArb).map(([a, text, b]) => a + text + b),
    boundaryArb,
  ];
  if (cls.kind === 'initials') options.push(initialsSentenceArb(cls.initials), initialsSentenceArb(cls.initials));
  return fc.oneof(...options);
}

/** Lists of 0 to 50 items, with case variants of earlier items mixed in. */
function listArb(cls: InputClassification): fc.Arbitrary<string[]> {
  return fc
    .tuple(fc.array(itemArb(cls), { maxLength: 50 }), fc.array(fc.tuple(fc.nat(), fc.nat(), fc.boolean()), { maxLength: 6 }))
    .map(([items, variants]) => {
      const out = [...items];
      for (const [from, to, upper] of variants) {
        if (out.length === 0 || out.length >= 50) break;
        const source = out[from % out.length] ?? '';
        out.splice(to % (out.length + 1), 0, upper ? source.toUpperCase() : source.toLowerCase());
      }
      return out;
    });
}

describe('suggestion filter properties', () => {
  it('returns schema-valid, ordered, initials-exact output and leaves the input unchanged', () => {
    // Feature: expansion, Property 16: The filter output is schema-valid, ordered and initials-exact
    const caseArb = classificationArb.chain((cls) => fc.tuple(fc.constant(cls), listArb(cls)));
    fc.assert(
      fc.property(caseArb, ([cls, list]) => {
        const before = [...list];
        const out = filterSuggestions(list, cls);
        expect(out).toStrictEqual(refFilter(list, cls));
        expect(ExpandResponseSchema.safeParse({ suggestions: out }).success).toBe(true);
        if (cls.kind === 'initials') for (const s of out) expect(initialsOf(s)).toBe(cls.initials);
        expect(list).toStrictEqual(before);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
