import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { SYSTEM_PROMPT, buildPrompt, neutralize, parseModelOutput } from './prompt';
import { ExpandRequestSchema, type ExpandRequest, type Turn } from './schema';
import {
  PROP_RUNS,
  contextArb,
  initialsLettersArb,
  renderTokensArb,
  renderedTokensArb,
  roleArb,
  textWithLenArb,
} from './test-support/arbitraries';

/** Schema-valid requests built from candidate texts and contexts. */
function requestArb(textArb: fc.Arbitrary<string>, ctxArb: fc.Arbitrary<readonly Turn[]>): fc.Arbitrary<ExpandRequest> {
  return fc
    .tuple(textArb, ctxArb)
    .map(([text, context]) => ExpandRequestSchema.safeParse({ text, context }))
    .filter((result) => result.success)
    .map((result) => (result.success ? result.data : { text: 'x', context: [] }));
}

const initialsTextArb = initialsLettersArb.chain((letters) =>
  fc.oneof(renderTokensArb([letters]), renderTokensArb(letters.split(''))),
);

/** Text salted with marker look-alikes and newlines at random positions. */
const saltArb = fc.constantFrom('<<<', '>>>', '<<<<<', '>>>>', 'CONTEXT>>>', '<<<CONTEXT', '<<<TYPED', 'TYPED>>>', '\n', '<<', '>>', '<', '>');
const saltedTextArb = (max: number): fc.Arbitrary<string> =>
  fc
    .array(fc.oneof(fc.string({ maxLength: 12 }), saltArb, renderedTokensArb.map(({ text }) => text)), { minLength: 1, maxLength: 8 })
    .map((pieces) => pieces.join('').slice(0, max));

const saltedTurnArb: fc.Arbitrary<Turn> = fc
  .record({ role: roleArb, text: saltedTextArb(500) }, { noNullPrototype: true })
  .filter((turn) => turn.text.length >= 1);

const saltedContextArb: fc.Arbitrary<Turn[]> = fc.oneof(
  fc.constant<Turn[]>([]),
  saltedTurnArb.map((turn) => [{ ...turn, role: 'partner' as const }]),
  fc.array(saltedTurnArb, { minLength: 2, maxLength: 10 }),
);

/** Indices of every (overlapping) occurrence of `needle`. */
function occurrences(haystack: string, needle: string): number[] {
  const found: number[] = [];
  for (let i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + 1)) found.push(i);
  return found;
}

function between(text: string, open: string, close: string): string {
  const start = text.indexOf(open);
  const end = text.indexOf(close);
  return text.slice(start + open.length, end);
}

describe('prompt properties', () => {
  it('builds a fixed system message and a deterministic user message', () => {
    // Feature: expansion, Property 12: The prompt has a fixed system message and is deterministic
    const reqArb = requestArb(
      fc.oneof(textWithLenArb(1, 200), renderedTokensArb.map(({ text }) => text), initialsTextArb),
      contextArb,
    );
    fc.assert(
      fc.property(reqArb, (req) => {
        const messages = buildPrompt(req, classify(req.text));
        expect(messages).toHaveLength(2);
        expect(messages.map((m) => m.role)).toStrictEqual(['system', 'user']);
        expect(messages[0].content).toBe(SYSTEM_PROMPT);
        const copy = structuredClone(req);
        expect(buildPrompt(copy, classify(copy.text))).toStrictEqual(messages);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('keeps all data inside intact delimiters', () => {
    // Feature: expansion, Property 13: The user message carries all data inside intact delimiters
    const reqArb = requestArb(
      fc.oneof(saltedTextArb(220), initialsTextArb, renderedTokensArb.map(({ text }) => text)),
      saltedContextArb,
    );
    fc.assert(
      fc.property(reqArb, fc.string({ maxLength: 60 }), saltedTextArb(80), (req, plain, salted) => {
        const cls = classify(req.text);
        const user = buildPrompt(req, cls)[1].content;
        expect(occurrences(user, '<<<CONTEXT')).toHaveLength(1);
        expect(occurrences(user, 'CONTEXT>>>')).toHaveLength(1);
        expect(occurrences(user, '<<<TYPED')).toHaveLength(1);
        expect(occurrences(user, 'TYPED>>>')).toHaveLength(1);
        expect(occurrences(user, '<<<')).toHaveLength(2);
        expect(occurrences(user, '>>>')).toHaveLength(2);
        expect(user.indexOf('<<<CONTEXT')).toBeLessThan(user.indexOf('CONTEXT>>>'));
        expect(user.indexOf('CONTEXT>>>')).toBeLessThan(user.indexOf('<<<TYPED'));
        expect(user.indexOf('<<<TYPED')).toBeLessThan(user.indexOf('TYPED>>>'));

        let latestPartner = -1;
        req.context.forEach((turn, i) => {
          if (turn.role === 'partner') latestPartner = i;
        });
        const expectedContext =
          req.context.length === 0
            ? '(no conversation context)'
            : req.context
                .map((turn, i) => {
                  const label = i === latestPartner ? 'partner (the speaker is replying to this line)' : turn.role;
                  return `${label}: ${neutralize(turn.text)}`;
                })
                .join('\n');
        expect(between(user, '<<<CONTEXT\n', '\nCONTEXT>>>')).toBe(expectedContext);
        expect(occurrences(user, 'the speaker is replying to this line')).toHaveLength(latestPartner >= 0 ? 1 : 0);
        expect(between(user, '<<<TYPED\n', '\nTYPED>>>')).toBe(neutralize(req.text));
        if (cls.kind === 'initials') {
          expect(user).toContain(`"${cls.initials}" (${cls.initials.length} letters)`);
          expect(user).toContain(`exactly ${cls.initials.length} words`);
        }
        if (cls.kind === 'partial') expect(user).toContain(`complete the last one ("${cls.tokens[cls.tokens.length - 1]}")`);

        for (const s of [plain, salted]) {
          const out = neutralize(s);
          expect(out.includes('<<<') || out.includes('>>>')).toBe(false);
          if (!s.includes('<<<') && !s.includes('>>>')) expect(out).toBe(s);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('never throws and returns only strings', () => {
    // Feature: expansion, Property 14: The output parser never throws and returns only strings
    const jsonSuggestions = fc
      .array(fc.oneof(fc.string(), fc.integer(), fc.boolean(), fc.constant(null), fc.jsonValue()), { maxLength: 6 })
      .map((xs) => JSON.stringify({ suggestions: xs }));
    const rawArb = fc.oneof(
      fc.string({ unit: 'binary', maxLength: 10_000 }),
      fc.json(),
      fc.tuple(jsonSuggestions, fc.nat()).map(([json, cut]) => json.slice(0, cut % (json.length + 1))),
      fc
        .array(fc.constantFrom('{', '}', '"', '\\', '"suggestions"', ':', '[', ']', ',', 'a'), { maxLength: 3000 })
        .map((pieces) => pieces.join('')),
      jsonSuggestions.map((json) => `\`\`\`json\n${json}`),
      fc.tuple(fc.string(), jsonSuggestions, fc.string()).map(([p, json, q]) => p + json + q),
    );
    fc.assert(
      fc.property(rawArb, (raw) => {
        const out = parseModelOutput(raw);
        expect(Array.isArray(out)).toBe(true);
        for (const entry of out) expect(typeof entry).toBe('string');
        expect(parseModelOutput(raw)).toStrictEqual(out);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('extracts the earliest suggestions object', () => {
    // Feature: expansion, Property 15: The parser extracts the earliest suggestions object
    const elementArb = fc.oneof(
      fc.string({ unit: 'binary' }),
      fc.constantFrom('{', '}', '"', ' a { b } ', '\\', '😀', '\n'),
      fc.integer(),
      fc.boolean(),
      fc.constant(null),
      fc.dictionary(fc.string({ maxLength: 4 }), fc.jsonValue({ maxDepth: 2 }), { maxKeys: 3 }),
    );
    const extraArb = fc.dictionary(
      fc.string({ maxLength: 8 }).filter((key) => key !== 'suggestions' && key !== '__proto__'),
      fc.jsonValue({ maxDepth: 2 }).filter((v) => !JSON.stringify(v).includes('"suggestions"')),
      { maxKeys: 3 },
    );
    const noBraceArb = fc.string({ unit: 'binary' }).map((s) => s.replaceAll('{', ''));
    const wrapArb = fc.constantFrom(
      (s: string) => s,
      (s: string) => `\`\`\`json\n${s}\n\`\`\``,
      (s: string) => `\`\`\`\n${s}\n\`\`\``,
    );
    const secondArb = fc.option(
      fc.array(fc.string(), { maxLength: 3 }).map((ys) => JSON.stringify({ suggestions: [...ys, 'second object'] })),
      { nil: '' },
    );
    const extractCase = fc
      .record({ xs: fc.array(elementArb, { maxLength: 6 }), extra: extraArb, p: noBraceArb, q: fc.string(), second: secondArb, wrap: wrapArb })
      .map(({ xs, extra, p, q, second, wrap }) => ({
        raw: p + wrap(JSON.stringify({ suggestions: xs, ...extra })) + q + second,
        expected: xs.filter((x): x is string => typeof x === 'string'),
      }));
    const emptyCase = fc.oneof(
      noBraceArb.map((raw) => ({ raw, expected: [] as string[] })),
      fc.string({ unit: 'binary' }).map((s) => ({ raw: s.replaceAll('"suggestions"', '"suggestion"'), expected: [] as string[] })),
      fc.array(fc.string(), { maxLength: 4 }).map((xs) => ({ raw: JSON.stringify(xs), expected: [] as string[] })),
      fc
        .oneof(fc.string(), fc.integer(), fc.constant(null), fc.boolean(), fc.dictionary(fc.constantFrom('a', 'b'), fc.string()))
        .map((value) => ({ raw: `Here you go: ${JSON.stringify({ suggestions: value })}`, expected: [] as string[] })),
    );
    fc.assert(
      fc.property(fc.oneof({ weight: 3, arbitrary: extractCase }, { weight: 2, arbitrary: emptyCase }), ({ raw, expected }) => {
        expect(parseModelOutput(raw)).toStrictEqual(expected);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
