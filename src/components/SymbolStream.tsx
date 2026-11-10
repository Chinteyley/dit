export interface SymbolStreamProps {
  /** Current_Pattern: '.' and '-' only. */
  readonly pattern: string;
}

/**
 * The live Symbol_Stream (Requirement 11): the symbols keyed so far for the next character, as
 * near-white dot circles (u by u) and dash pills (3.25u by u) with a 1u gap, the newest one in the
 * accent colour. The unit u comes from the surrounding morse-scale container, which leaves room
 * for 12 dashes. The row keeps its height when empty, never shrinks, and its shapes are hidden
 * from assistive technology; one plain text alternative ("dot dash dot") stands for them, outside
 * the Live_Region, so presses are never announced. A new symbol settles in for 150 ms, and not at
 * all under reduced motion.
 */
export function SymbolStream({ pattern }: SymbolStreamProps) {
  const symbols = [...pattern].filter((symbol) => symbol === '.' || symbol === '-');
  const words = symbols.map((symbol) => (symbol === '.' ? 'dot' : 'dash')).join(' ');
  const newest = symbols.length - 1;

  return (
    <div className="flex h-(--sym-u) flex-none items-center">
      <div aria-hidden="true" className="flex items-center gap-(--sym-u)">
        {symbols.map((symbol, index) => (
          <span
            // Index keys: an appended symbol mounts (and settles in); earlier ones stay put.
            key={index}
            role="img"
            aria-label={symbol === '.' ? 'dot' : 'dash'}
            className={`block motion-safe:animate-settle ${symbol === '.' ? 'glyph-dot' : 'glyph-dash'} ${
              index === newest ? 'bg-accent' : 'bg-text'
            }`}
          />
        ))}
      </div>
      <span className="sr-only">{words}</span>
    </div>
  );
}
