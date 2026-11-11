// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeGlyphs, DASH_UNITS, DOT_UNITS, type GlyphSize } from './CodeGlyphs';

afterEach(cleanup);

/** A glyph's width or height in units of --sym-u, read from its inline style. */
function units(glyph: HTMLElement, side: 'width' | 'height'): number {
  const value = glyph.style.getPropertyValue(side);
  if (value === 'var(--sym-u)') return 1;
  const match = /^calc\(var\(--sym-u\) \* ([\d.]+)\)$/.exec(value);
  if (match?.[1] === undefined) throw new Error(`unexpected ${side}: ${value}`);
  return Number(match[1]);
}

const glyphs = (): HTMLElement[] => screen.getAllByRole('img', { hidden: true });

describe('CodeGlyphs', () => {
  it('hides the whole row from assistive technology', () => {
    render(<CodeGlyphs code=".-.-." size="legend" />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    for (const glyph of glyphs()) expect(glyph.closest('[aria-hidden="true"]')).not.toBeNull();
  });

  it('draws one glyph per symbol, in code order', () => {
    render(<CodeGlyphs code="...---..." size="sheet" />);
    expect(glyphs().map((glyph) => glyph.getAttribute('aria-label'))).toEqual([
      'dot', 'dot', 'dot', 'dash', 'dash', 'dash', 'dot', 'dot', 'dot',
    ]);
  });

  it('draws a dash at least 3 times as wide as a dot, at the same height (the Symbol_Stream shapes)', () => {
    render(<CodeGlyphs code=".-" size="practice" />);
    const [dot, dash] = glyphs();
    if (dot === undefined || dash === undefined) throw new Error('two glyphs expected');
    expect(units(dot, 'width')).toBe(DOT_UNITS);
    expect(units(dash, 'width')).toBe(DASH_UNITS);
    expect(units(dash, 'width') / units(dot, 'width')).toBeGreaterThanOrEqual(3);
    expect(units(dash, 'height')).toBe(units(dot, 'height'));
  });

  it.each<[GlyphSize, string]>([
    ['legend', '0.75rem'],
    ['sheet', '0.625rem'],
    ['practice', '1.25rem'],
  ])('sizes the %s unit, and never wider than 1/24 of its container', (size, max) => {
    render(<CodeGlyphs code="-" size={size} />);
    const row = glyphs()[0]?.parentElement;
    expect(row?.style.getPropertyValue('--sym-u')).toBe(`min(${max}, 100cqi / 24)`);
  });

  it('skips anything that is not a dot or a dash and draws nothing for an empty code', () => {
    const { rerender } = render(<CodeGlyphs code=".x-" size="legend" />);
    expect(glyphs()).toHaveLength(2);
    rerender(<CodeGlyphs code="" size="legend" />);
    expect(screen.queryAllByRole('img', { hidden: true })).toHaveLength(0);
  });

  it('uses no animation or transition', () => {
    const { container } = render(<CodeGlyphs code="-.-." size="legend" />);
    for (const element of container.querySelectorAll('*')) {
      expect(element.getAttribute('class') ?? '').not.toMatch(/animate|transition/);
    }
  });
});
