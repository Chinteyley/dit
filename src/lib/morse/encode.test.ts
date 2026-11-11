import { describe, expect, it } from 'vitest';
import { encode, normalizeText } from './encode';

describe('normalizeText', () => {
  it('lowercases A–Z, trims and collapses Whitespace', () => {
    expect(normalizeText('  Hi\t\tTHERE \r\n you ')).toBe('hi there you');
  });

  it('changes no other character', () => {
    expect(normalizeText('ÉÀ?')).toBe('ÉÀ?');
  });
});

describe('encode', () => {
  it('encodes e as one 1-unit press with End_Time 3 units later', () => {
    expect(encode('e', 200)).toStrictEqual({
      ok: true,
      value: {
        inputs: [
          { type: 'press', t: 0 },
          { type: 'release', t: 200 },
        ],
        endTime: 800,
      },
    });
  });

  it('uses 1-unit symbol gaps, 3-unit letter gaps and 7-unit word gaps', () => {
    const result = encode('A t', 100);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // a = .-  (press 0–100, gap, press 200–500), word gap 7, t = - (press 1200–1500)
    expect(result.value.inputs.map((input) => input.t)).toStrictEqual([0, 100, 200, 500, 1200, 1500]);
    expect(result.value.endTime).toBe(1800);
  });

  it('reports + as unsupported and never emits the speak code for it', () => {
    expect(encode('+', 200)).toStrictEqual({
      ok: false,
      error: { text: { kind: 'unsupported', occurrences: [{ char: '+', index: 0 }] } },
    });
  });

  it('reports empty and Whitespace-only text', () => {
    expect(encode('  ', 200)).toStrictEqual({ ok: false, error: { text: { kind: 'empty' } } });
    expect(encode('', 200)).toStrictEqual({ ok: false, error: { text: { kind: 'empty' } } });
  });

  it('rejects units outside [60, 1500]', () => {
    expect(encode('a', 59)).toStrictEqual({ ok: false, error: { unit: { value: 59 } } });
    expect(encode('a', 1501)).toStrictEqual({ ok: false, error: { unit: { value: 1501 } } });
    expect(encode('a', Number.NaN).ok).toBe(false);
  });

  it('reports a text error and a unit error together', () => {
    expect(encode('a#', Infinity)).toStrictEqual({
      ok: false,
      error: {
        unit: { value: Infinity },
        text: { kind: 'unsupported', occurrences: [{ char: '#', index: 1 }] },
      },
    });
  });

  it('reports an emoji once at its UTF-16 start index', () => {
    expect(encode('a😀b😀', 200)).toStrictEqual({
      ok: false,
      error: {
        text: {
          kind: 'unsupported',
          occurrences: [
            { char: '😀', index: 1 },
            { char: '😀', index: 4 },
          ],
        },
      },
    });
  });
});
