import { describe, expect, it } from 'vitest';
import { classify } from './classify';

describe('classify', () => {
  it('reads one unknown all-letter token as initials', () => {
    expect(classify('iwtgo')).toStrictEqual({ kind: 'initials', tokens: ['iwtgo'], initials: 'iwtgo' });
    expect(classify('wa')).toStrictEqual({ kind: 'initials', tokens: ['wa'], initials: 'wa' });
  });

  it('reads spaced single letters as initials whatever the case and punctuation', () => {
    expect(classify('I W T G O.')).toStrictEqual({
      kind: 'initials',
      tokens: ['i', 'w', 't', 'g', 'o'],
      initials: 'iwtgo',
    });
    expect(classify('  IwTgO  ')).toStrictEqual(classify('iwtgo'));
  });

  it('reads 2 single letters as initials even when they are Known_Words', () => {
    expect(classify('i a')).toStrictEqual({ kind: 'initials', tokens: ['i', 'a'], initials: 'ia' });
  });

  it('reads a Known_Word as words', () => {
    expect(classify('go')).toStrictEqual({ kind: 'words', tokens: ['go'] });
    expect(classify('i')).toStrictEqual({ kind: 'words', tokens: ['i'] });
  });

  it('reads an unknown last token that starts a word as partial', () => {
    expect(classify('i want wa')).toStrictEqual({ kind: 'partial', tokens: ['i', 'want', 'wa'] });
    expect(classify('I want, WA!')).toStrictEqual({ kind: 'partial', tokens: ['i', 'want', 'wa'] });
  });

  it('reads complete words, digits and mixed input as words', () => {
    expect(classify('i want water')).toStrictEqual({ kind: 'words', tokens: ['i', 'want', 'water'] });
    expect(classify('123')).toStrictEqual({ kind: 'words', tokens: ['123'] });
    expect(classify('i w water')).toStrictEqual({ kind: 'words', tokens: ['i', 'w', 'water'] });
  });

  it('reads 13 single letters by their last letter', () => {
    expect(classify('b c d e f g h j k l m n a').kind).toBe('words');
    expect(classify('b c d e f g h j k l m n w').kind).toBe('words');
  });

  it('reads a 13-letter token by whether it starts a word', () => {
    expect(classify('zqzqzqzqzqzqz').kind).toBe('words');
  });

  it('reads text without tokens as empty', () => {
    for (const text of ['', '   ', '?!', 'é']) expect(classify(text)).toStrictEqual({ kind: 'empty', tokens: [] });
  });

  it('returns a fresh tokens array each time', () => {
    const a = classify('i want');
    const b = classify('i want');
    expect(a).toStrictEqual(b);
    expect(a.tokens).not.toBe(b.tokens);
  });
  it('reads paused initials after a known leading word as initials (Req 20.5)', () => {
    expect(classify('i wtgo')).toMatchObject({ kind: 'initials', initials: 'iwtgo' });
    expect(classify('i nh')).toMatchObject({ kind: 'initials', initials: 'inh' });
  });

  it('keeps everyday word input with a 3+ letter known word as words (Req 20.5)', () => {
    expect(classify('mom come').kind).toBe('words');
    expect(classify('ok thanks').kind).toBe('words');
  });
});
