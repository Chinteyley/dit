import { describe, expect, it } from 'vitest';
import { classify } from './classify';
import { filterSuggestions } from './filter';

describe('filterSuggestions', () => {
  it('keeps only sentences whose initials match the typed letters', () => {
    expect(filterSuggestions(['I would like to go out.', 'I want to go outside.'], classify('iwtgo'))).toStrictEqual([
      'I want to go outside.',
    ]);
  });

  it('trims Whitespace and drops blank and over-long candidates', () => {
    expect(filterSuggestions(['  I am cold. \n', ' \t ', '', 'x'.repeat(201), `${'y'.repeat(200)}  `], classify('i am'))).toStrictEqual([
      'I am cold.',
      'y'.repeat(200),
    ]);
  });

  it('keeps the first of case-insensitive repeats and at most 3', () => {
    expect(filterSuggestions(['Yes', 'yes', 'No', 'Maybe', 'Later'], classify('y'))).toStrictEqual(['Yes', 'No', 'Maybe']);
  });

  it('does not check initials for partial or word input', () => {
    expect(filterSuggestions(['Totally different.'], classify('i want wa'))).toStrictEqual(['Totally different.']);
  });

  it('returns [] for an empty list and leaves the input unchanged', () => {
    expect(filterSuggestions([], classify('iwtgo'))).toStrictEqual([]);
    const input = [' a '];
    filterSuggestions(input, classify('a'));
    expect(input).toStrictEqual([' a ']);
  });
});
