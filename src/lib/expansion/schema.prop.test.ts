import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { trimWhitespace, isWhitespace } from './normalize';
import { ExpandRequestSchema, ExpandResponseSchema, TurnSchema, isValidSuggestionText, type Turn } from './schema';
import {
  PROP_RUNS,
  nonWsLookalikeArb,
  roleArb,
  textWithLenArb,
  turnArb,
  turnTextArb,
  wsArb,
  wsOnlyWithLenArb,
} from './test-support/arbitraries';

interface Case {
  readonly branch: string;
  readonly value: unknown;
}

const extraKeysArb = fc.dictionary(fc.constantFrom('id', 'at', 'Role', 'TEXT', 'meta', 'source'), fc.jsonValue(), {
  maxKeys: 3,
});

const nonObjectArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constant(null),
  fc.constant(undefined),
  fc.array(fc.jsonValue(), { maxLength: 3 }),
  fc.string(),
  fc.double(),
  fc.boolean(),
);

const wrongTypeArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.integer(),
  fc.boolean(),
  fc.constant(null),
  fc.array(fc.string(), { maxLength: 2 }),
  fc.dictionary(fc.string({ maxLength: 3 }), fc.string({ maxLength: 3 }), { maxKeys: 2 }),
);

/** Turn-like values that break exactly one Turn rule, tagged by the rule they break. */
const brokenTurnArb: fc.Arbitrary<Case> = fc.oneof(
  roleArb.map((role) => ({ branch: 'text-empty', value: { role, text: '' } })),
  fc.record({ role: roleArb, text: textWithLenArb(501, 501) }).map((value) => ({ branch: 'text-501', value })),
  fc
    .record({ role: fc.constantFrom('Speaker', 'PARTNER', 'system', 'user', '', 'speaker ', ' partner'), text: turnTextArb })
    .map((value) => ({ branch: 'role-near-miss', value })),
  turnTextArb.map((text) => ({ branch: 'role-missing', value: { text } })),
  roleArb.map((role) => ({ branch: 'text-missing', value: { role } })),
  fc.record({ role: wrongTypeArb, text: turnTextArb }).map((value) => ({ branch: 'role-wrong-type', value })),
  fc.record({ role: roleArb, text: wrongTypeArb }).map((value) => ({ branch: 'text-wrong-type', value })),
  nonObjectArb.map((value) => ({ branch: 'not-object', value })),
);

/** Strings of exactly `length` units whose first and last characters are not Whitespace. */
function coreArb(min: number, max: number): fc.Arbitrary<string> {
  return fc
    .tuple(textWithLenArb(min, max), fc.option(nonWsLookalikeArb, { nil: undefined }))
    .map(([text, lookalike]) => {
      const chars = text.split('');
      if (chars.length > 0 && isWhitespace(chars[0] ?? '')) chars[0] = 'x';
      if (chars.length > 0 && isWhitespace(chars[chars.length - 1] ?? '')) chars[chars.length - 1] = 'y';
      // A leading look-alike is part of the core: it is kept and counted.
      if (lookalike !== undefined && chars.length > 0) chars[0] = lookalike;
      return chars.join('');
    });
}

const validCoreArb = fc.oneof(coreArb(1, 1), coreArb(200, 200), coreArb(1, 200));
const contextArbOfLength = (min: number, max: number): fc.Arbitrary<Turn[]> =>
  fc.oneof(
    fc.array(turnArb, { minLength: min, maxLength: min }),
    fc.array(turnArb, { minLength: max, maxLength: max }),
    fc.array(turnArb, { minLength: min, maxLength: max }),
  );

interface RequestCase extends Case {
  readonly expected?: { readonly text: string; readonly context: readonly Turn[] };
}

const requestCaseArb: fc.Arbitrary<RequestCase> = fc
  .record({ ws1: wsArb, ws2: wsArb, extra: extraKeysArb })
  .chain(({ ws1, ws2, extra }) =>
    fc.oneof(
      { weight: 4, arbitrary: fc
        .record({ core: validCoreArb, context: contextArbOfLength(0, 10) })
        .map(({ core, context }) => ({
          branch: 'valid',
          value: { ...extra, text: ws1 + core + ws2, context },
          expected: { text: core, context },
        })) },
      { weight: 1, arbitrary: contextArbOfLength(0, 10).map((context) => ({ branch: 'text-empty', value: { ...extra, text: ws1 + ws2, context } })) },
      { weight: 1, arbitrary: fc
        .record({ core: coreArb(201, 210), context: contextArbOfLength(0, 10) })
        .map(({ core, context }) => ({ branch: 'text-201', value: { ...extra, text: ws1 + core + ws2, context } })) },
      { weight: 1, arbitrary: contextArbOfLength(0, 10).map((context) => ({ branch: 'text-missing', value: { ...extra, context } })) },
      { weight: 1, arbitrary: fc
        .record({ text: wrongTypeArb, context: contextArbOfLength(0, 10) })
        .map(({ text, context }) => ({ branch: 'text-wrong-type', value: { ...extra, text, context } })) },
      { weight: 1, arbitrary: fc
        .record({ core: validCoreArb, context: contextArbOfLength(11, 12) })
        .map(({ core, context }) => ({ branch: 'context-11', value: { ...extra, text: core, context } })) },
      { weight: 1, arbitrary: validCoreArb.map((core) => ({ branch: 'context-missing', value: { ...extra, text: core } })) },
      { weight: 1, arbitrary: fc
        .record({ core: validCoreArb, context: fc.oneof(fc.constant(null), fc.string(), fc.integer(), fc.constant({ role: 'speaker', text: 'hi' })) })
        .map(({ core, context }) => ({ branch: 'context-not-array', value: { ...extra, text: core, context } })) },
      { weight: 2, arbitrary: fc
        .record({ core: validCoreArb, context: contextArbOfLength(0, 9), bad: brokenTurnArb, at: fc.nat() })
        .map(({ core, context, bad, at }) => {
          const turns: unknown[] = [...context];
          turns.splice(at % (context.length + 1), 0, bad.value);
          return { branch: `context-bad-turn:${bad.branch}`, value: { ...extra, text: core, context: turns } };
        }) },
      { weight: 1, arbitrary: nonObjectArb.map((value) => ({ branch: 'not-object', value })) },
    ),
  );

const validSuggestionArb = fc.oneof(textWithLenArb(1, 1), textWithLenArb(200, 200), textWithLenArb(1, 200)).filter(isValidSuggestionText);
const distinctListArb = (min: number, max: number): fc.Arbitrary<string[]> =>
  fc.uniqueArray(validSuggestionArb, { minLength: min, maxLength: max, selector: (s) => s.toLowerCase() });

interface ResponseCase extends Case {
  readonly expected?: readonly string[];
}

function insertAt<T>(list: readonly T[], item: T, at: number): T[] {
  const out = [...list];
  out.splice(at % (list.length + 1), 0, item);
  return out;
}

const responseCaseArb: fc.Arbitrary<ResponseCase> = extraKeysArb.chain((extra) =>
  fc.oneof(
    { weight: 4, arbitrary: distinctListArb(0, 3).map((list) => ({ branch: 'valid', value: { ...extra, suggestions: list }, expected: list })) },
    { weight: 1, arbitrary: distinctListArb(4, 6).map((list) => ({ branch: 'too-many', value: { ...extra, suggestions: list } })) },
    { weight: 1, arbitrary: fc
      .record({ list: distinctListArb(0, 2), bad: textWithLenArb(201, 201), at: fc.nat() })
      .map(({ list, bad, at }) => ({ branch: 'too-long', value: { ...extra, suggestions: insertAt(list, bad, at) } })) },
    { weight: 1, arbitrary: fc
      .record({ list: distinctListArb(0, 2), at: fc.nat() })
      .map(({ list, at }) => ({ branch: 'empty-string', value: { ...extra, suggestions: insertAt(list, '', at) } })) },
    { weight: 1, arbitrary: fc
      .record({ list: distinctListArb(0, 2), bad: wsOnlyWithLenArb(1, 200), at: fc.nat() })
      .map(({ list, bad, at }) => ({ branch: 'whitespace-only', value: { ...extra, suggestions: insertAt(list, bad, at) } })) },
    { weight: 1, arbitrary: fc
      .record({ list: distinctListArb(0, 2), bad: wrongTypeArb, at: fc.nat() })
      .map(({ list, bad, at }) => ({ branch: 'non-string', value: { ...extra, suggestions: insertAt<unknown>(list, bad, at) } })) },
    { weight: 1, arbitrary: fc
      .record({ list: distinctListArb(1, 2), pick: fc.nat(), at: fc.nat(), upper: fc.boolean() })
      .map(({ list, pick, at, upper }) => {
        const original = list[pick % list.length] ?? 'Yes';
        const variant = upper ? original.toUpperCase() : original.toLowerCase();
        return { branch: 'case-duplicate', value: { ...extra, suggestions: insertAt(list, variant, at) } };
      }) },
    { weight: 1, arbitrary: fc.constant({ branch: 'suggestions-missing', value: { ...extra } }) },
    { weight: 1, arbitrary: fc
      .oneof(fc.string(), fc.constant(null), fc.integer(), fc.constant({ 0: 'Yes' }))
      .map((suggestions) => ({ branch: 'suggestions-not-array', value: { ...extra, suggestions } })) },
    { weight: 1, arbitrary: nonObjectArb.map((value) => ({ branch: 'not-object', value })) },
  ),
);

describe('schema properties', () => {
  it('accepts exactly the valid Turns and strips other keys', () => {
    // Feature: expansion, Property 1: Turn schema accepts exactly the valid Turns
    const caseArb: fc.Arbitrary<Case & { readonly expected?: Turn }> = fc.oneof(
      fc.record({ turn: turnArb, extra: extraKeysArb }).map(({ turn, extra }) => ({
        branch: 'valid',
        value: { ...extra, ...turn },
        expected: turn,
      })),
      brokenTurnArb,
    );
    fc.assert(
      fc.property(caseArb, (c) => {
        const result = TurnSchema.safeParse(c.value);
        expect(result.success).toBe(c.branch === 'valid');
        if (result.success) expect(result.data).toStrictEqual({ role: c.expected?.role, text: c.expected?.text });
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('trims only Whitespace from the request text and enforces the request limits', () => {
    // Feature: expansion, Property 2: Request schema trims Whitespace only and enforces limits
    fc.assert(
      fc.property(requestCaseArb, (c) => {
        const result = ExpandRequestSchema.safeParse(c.value);
        expect(result.success).toBe(c.branch === 'valid');
        if (result.success) {
          expect(result.data).toStrictEqual({
            text: c.expected?.text,
            context: c.expected?.context.map((turn) => ({ role: turn.role, text: turn.text })),
          });
          expect(result.data.text).toBe(trimWhitespace((c.value as { text: string }).text));
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('accepts exactly short, distinct, displayable suggestion lists', () => {
    // Feature: expansion, Property 3: Response schema accepts exactly short, distinct, displayable lists
    fc.assert(
      fc.property(responseCaseArb, (c) => {
        const result = ExpandResponseSchema.safeParse(c.value);
        expect(result.success).toBe(c.branch === 'valid');
        if (result.success) expect(result.data).toStrictEqual({ suggestions: c.expected });
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
