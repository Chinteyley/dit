import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  CONTEXT_MAX_TURNS,
  ExpandRequestSchema,
  ExpandResponseSchema,
  CANDIDATES_MAX,
  REQUEST_TEXT_MAX,
  SUGGESTIONS_MAX,
  SUGGESTION_TEXT_MAX,
  TURN_TEXT_MAX,
  TurnSchema,
  distinctCaseInsensitive,
  isValidSuggestionText,
  type ExpandRequest,
  type ExpandResponse,
  type Role,
  type Turn,
} from './schema';

describe('schema types', () => {
  it('infers the Turn, ExpandRequest, ExpandResponse and Role types', () => {
    expectTypeOf<Turn>().toEqualTypeOf<{ role: 'speaker' | 'partner'; text: string }>();
    expectTypeOf<Role>().toEqualTypeOf<'speaker' | 'partner'>();
    expectTypeOf<ExpandRequest>().toEqualTypeOf<{ text: string; context: { role: 'speaker' | 'partner'; text: string }[] }>();
    expectTypeOf<ExpandResponse>().toEqualTypeOf<{ suggestions: string[] }>();
  });

  it('exports the limits from the requirements', () => {
    expect([TURN_TEXT_MAX, REQUEST_TEXT_MAX, CONTEXT_MAX_TURNS, SUGGESTIONS_MAX, SUGGESTION_TEXT_MAX, CANDIDATES_MAX]).toStrictEqual([
      500, 200, 10, 3, 200, 5,
    ]);
  });
});

describe('TurnSchema', () => {
  it('accepts 1 and 500 characters, Whitespace-only text included, and strips other keys', () => {
    expect(TurnSchema.safeParse({ role: 'partner', text: ' ', at: 3 })).toStrictEqual({
      success: true,
      data: { role: 'partner', text: ' ' },
    });
    expect(TurnSchema.safeParse({ role: 'speaker', text: 'x'.repeat(500) }).success).toBe(true);
  });

  it('rejects 0 and 501 characters, other roles and non-objects', () => {
    expect(TurnSchema.safeParse({ role: 'speaker', text: '' }).success).toBe(false);
    expect(TurnSchema.safeParse({ role: 'speaker', text: 'x'.repeat(501) }).success).toBe(false);
    expect(TurnSchema.safeParse({ role: 'Speaker', text: 'hi' }).success).toBe(false);
    expect(TurnSchema.safeParse({ role: 'system', text: 'hi' }).success).toBe(false);
    expect(TurnSchema.safeParse(null).success).toBe(false);
    expect(TurnSchema.safeParse([{ role: 'speaker', text: 'hi' }]).success).toBe(false);
    expect(TurnSchema.safeParse('hi').success).toBe(false);
  });

  it('counts an astral character as 2 code units', () => {
    expect(TurnSchema.safeParse({ role: 'speaker', text: '😀'.repeat(250) }).success).toBe(true);
    expect(TurnSchema.safeParse({ role: 'speaker', text: `${'😀'.repeat(250)}x` }).success).toBe(false);
  });
});

describe('ExpandRequestSchema', () => {
  it('trims Whitespace from the request text only', () => {
    expect(ExpandRequestSchema.safeParse({ text: '  i want wa \n', context: [{ role: 'partner', text: ' hi ' }] })).toStrictEqual({
      success: true,
      data: { text: 'i want wa', context: [{ role: 'partner', text: ' hi ' }] },
    });
  });

  it('keeps look-alike characters and counts them', () => {
    const parsed = ExpandRequestSchema.safeParse({ text: '\u00A0hi\u00A0', context: [] });
    expect(parsed.success && parsed.data.text).toBe('\u00A0hi\u00A0');
  });

  it('rejects Whitespace-only text, 201 characters after trimming and 11 Turns', () => {
    expect(ExpandRequestSchema.safeParse({ text: ' \t\n', context: [] }).success).toBe(false);
    expect(ExpandRequestSchema.safeParse({ text: ` ${'a'.repeat(200)} `, context: [] }).success).toBe(true);
    expect(ExpandRequestSchema.safeParse({ text: 'a'.repeat(201), context: [] }).success).toBe(false);
    const turns = Array.from({ length: 11 }, () => ({ role: 'speaker', text: 'hi' }));
    expect(ExpandRequestSchema.safeParse({ text: 'hi', context: turns.slice(0, 10) }).success).toBe(true);
    expect(ExpandRequestSchema.safeParse({ text: 'hi', context: turns }).success).toBe(false);
  });

  it('rejects a missing context and non-objects', () => {
    expect(ExpandRequestSchema.safeParse({ text: 'hi' }).success).toBe(false);
    expect(ExpandRequestSchema.safeParse(null).success).toBe(false);
    expect(ExpandRequestSchema.safeParse(['hi', []]).success).toBe(false);
  });
});

describe('ExpandResponseSchema', () => {
  it('accepts an empty suggestions list', () => {
    expect(ExpandResponseSchema.safeParse({ suggestions: [] })).toStrictEqual({ success: true, data: { suggestions: [] } });
  });

  it('rejects case-variant duplicates', () => {
    expect(ExpandResponseSchema.safeParse({ suggestions: ['Yes', 'yES'] }).success).toBe(false);
  });

  it('returns the strings unchanged and strips other keys', () => {
    expect(ExpandResponseSchema.safeParse({ suggestions: [' Yes ', 'No.'], source: 'ai' })).toStrictEqual({
      success: true,
      data: { suggestions: [' Yes ', 'No.'] },
    });
  });

  it('rejects 4 items, blank items and over-long items', () => {
    expect(ExpandResponseSchema.safeParse({ suggestions: ['a', 'b', 'c', 'd'] }).success).toBe(false);
    expect(ExpandResponseSchema.safeParse({ suggestions: [' \n'] }).success).toBe(false);
    expect(ExpandResponseSchema.safeParse({ suggestions: [''] }).success).toBe(false);
    expect(ExpandResponseSchema.safeParse({ suggestions: ['a'.repeat(201)] }).success).toBe(false);
  });
});

describe('isValidSuggestionText and distinctCaseInsensitive', () => {
  it('needs 1 to 200 units with a non-Whitespace character', () => {
    expect(isValidSuggestionText('a')).toBe(true);
    expect(isValidSuggestionText('\u00A0')).toBe(true);
    expect(isValidSuggestionText(' \t')).toBe(false);
    expect(isValidSuggestionText('a'.repeat(200))).toBe(true);
    expect(isValidSuggestionText('a'.repeat(201))).toBe(false);
  });

  it('compares lowercased entries', () => {
    expect(distinctCaseInsensitive(['Yes', 'No'])).toBe(true);
    expect(distinctCaseInsensitive(['Yes', 'yes'])).toBe(false);
  });
});
