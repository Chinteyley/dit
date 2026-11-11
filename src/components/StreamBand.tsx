import type { CSSProperties } from 'react';
import { LetterTrail } from './LetterTrail';
import { SymbolStream } from './SymbolStream';

export interface StreamBandProps {
  /** Current_Text, drawn as the Letter_Trail. */
  readonly text: string;
  /** Current_Pattern: '.' and '-' only. */
  readonly pattern: string;
  /** A press is held, from a `down` Press_Event until its `up`. */
  readonly pressed: boolean;
}

/** Stream_Unit lengths: a dot is 1u across, a dash 3.25u long, and symbols sit 1u apart (Req 26.3). */
const DOT_UNITS = 1;
const DASH_UNITS = 3.25;
const GAP_UNITS = 1;
/** The 1u gap before the Press_Indicator plus one unit of it; morse-scale reserves the rest (1rem). */
const HEAD_UNITS = 2;

const isSymbol = (char: string): boolean => char === '.' || char === '-';

/**
 * The span of the Stream_Band in Stream_Units (Requirement 26.3): the length P of the pattern (1
 * per dot, 3.25 per dash and 1 per gap between two symbols, or 0 when it is empty) plus 2. The
 * morse-scale utility divides the band width, less --sym-press-min, by this span, so the pattern,
 * the gap and the Press_Indicator always fit (Req 11.4). It needs no minimum, because the base
 * unit already caps the drawn unit.
 */
export function streamSpan(pattern: string): number {
  const symbols = [...pattern].filter(isSymbol);
  if (symbols.length === 0) return HEAD_UNITS;
  const shapes = symbols.reduce((units, symbol) => units + (symbol === '.' ? DOT_UNITS : DASH_UNITS), 0);
  return shapes + (symbols.length - 1) * GAP_UNITS + HEAD_UNITS;
}

/**
 * The Stream_Band (Requirement 26): the Letter_Trail, the live Symbol_Stream and the
 * Press_Indicator in one row on one Stream_Unit, drawn straight on the Composer_Panel with no fill
 * or border of its own. The row keeps one height, set by the base unit, whatever it shows (Req
 * 11.3, 26.2); a pattern too long for the base unit shrinks the drawn unit through --stream-span,
 * and the oldest trail groups clip at the left, fading out across the Composer_Panel padding
 * (Req 26.5).
 *
 * The Press_Indicator sits where the next symbol will appear and is the only thing a press
 * changes (Req 25): a 2 px ring in the border colour while idle, and while pressed the same ring
 * in the accent colour around an accent centre half as wide as its inside, with the panel fill
 * showing between them, so a held press never reads as one more keyed dot next to the accent
 * newest symbol. Both states have the same size and no transition or animation. It is at least
 * 1rem across, so it stays visible on phones, and sits outside the Symbol_Stream, whose text
 * alternative and shapes do not change. A wrapper one glyph row high centres it on the symbols.
 * The wrapper, not the indicator, is aria-hidden, as the symbols' row is, so the indicator keeps
 * its name for role queries.
 */
export function StreamBand({ text, pattern, pressed }: StreamBandProps) {
  const span = { '--stream-span': streamSpan(pattern) } as CSSProperties;
  const hasPattern = [...pattern].some(isSymbol);

  return (
    <div className="morse-scale" style={span}>
      {/* Container units resolve against an ancestor container, so the height sits on this inner row. */}
      <div className="flex h-[calc(var(--sym-u-base)*1.75+1.25rem)] items-start">
        <LetterTrail text={text} />
        <SymbolStream pattern={pattern} />
        <span aria-hidden="true" className={`flex h-(--sym-u) flex-none items-center ${hasPattern ? 'ml-(--sym-u)' : ''}`}>
          <span
            role="img"
            aria-label="Press indicator"
            data-state={pressed ? 'pressed' : 'idle'}
            className={`flex size-[max(var(--sym-press-min),var(--sym-u))] flex-none items-center justify-center rounded-full border-2 ${
              pressed ? 'border-accent' : 'border-border'
            }`}
          >
            {pressed ? <span className="block size-1/2 rounded-full bg-accent" /> : null}
          </span>
        </span>
      </div>
    </div>
  );
}
