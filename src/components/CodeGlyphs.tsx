import type { CSSProperties } from 'react';

export type GlyphSize = 'legend' | 'sheet' | 'practice';

/** The largest unit u for each size: a dot is u across (onboarding-and-safety design "Components"). */
const MAX_UNIT: Readonly<Record<GlyphSize, string>> = Object.freeze({
  legend: '0.75rem',
  sheet: '0.625rem',
  practice: '1.25rem',
});

/** Glyph widths in units: the Symbol_Stream's shapes, a u by u dot and a 3.25u by u dash pill. */
export const DOT_UNITS = 1;
export const DASH_UNITS = 3.25;
/**
 * The longest code, SOS, is 6 dots, 3 dashes and 8 one-unit gaps: 23.75u. Capping u at 1/24 of
 * the nearest container's width keeps every code on one line inside it at 320 px (Req 8.7).
 */
const FIT_UNITS = 24;

export interface CodeGlyphsProps {
  /** '.' and '-' only; anything else is skipped. */
  readonly code: string;
  readonly size: GlyphSize;
}

/**
 * One code as Glyphs (Requirements 8.3, 9.5, 14.4, 18.6, 18.7): a dot is a u by u circle and a
 * dash a 3.25u by u pill, both near-white, 1u apart, so they match the live Symbol_Stream and
 * differ by shape and length, never by colour. The row is hidden from assistive technology; the
 * caller gives the code its Spoken_Code text. Nothing here animates.
 */
export function CodeGlyphs({ code, size }: CodeGlyphsProps) {
  const symbols = [...code].filter((symbol) => symbol === '.' || symbol === '-');
  const unit = { '--sym-u': `min(${MAX_UNIT[size]}, 100cqi / ${FIT_UNITS})` } as CSSProperties;

  return (
    <span aria-hidden="true" className="inline-flex shrink-0 items-center gap-(--sym-u) whitespace-nowrap" style={unit}>
      {symbols.map((symbol, index) => (
        <span
          key={index}
          role="img"
          aria-label={symbol === '.' ? 'dot' : 'dash'}
          className="block shrink-0 rounded-full bg-text"
          style={{
            width: `calc(var(--sym-u) * ${symbol === '.' ? DOT_UNITS : DASH_UNITS})`,
            height: 'var(--sym-u)',
          }}
        />
      ))}
    </span>
  );
}
