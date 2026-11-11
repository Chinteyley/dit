import { CHARACTER_TABLE } from '@/lib/morse';

export interface LetterTrailProps {
  /** Current_Text; the trail is derived from it alone. */
  readonly text: string;
}

/** Most characters drawn; the container clips whatever does not fit, oldest first. */
const TRAIL_MAX = 24;

type TrailItem =
  | { readonly kind: 'char'; readonly at: number; readonly char: string; readonly code: string }
  | { readonly kind: 'space'; readonly at: number };

/** The last TRAIL_MAX characters in typed order, with each run of spaces as one word gap. */
function trailItems(text: string): readonly TrailItem[] {
  const items: TrailItem[] = [];
  for (let at = Math.max(0, text.length - TRAIL_MAX); at < text.length; at++) {
    const char = text.charAt(at);
    if (char === ' ') {
      const last = items.at(-1);
      if (last !== undefined && last.kind !== 'space') items.push({ kind: 'space', at });
      continue;
    }
    // Own keys only; a character with no code is drawn as the bare letter.
    const code = Object.hasOwn(CHARACTER_TABLE, char) ? (CHARACTER_TABLE[char] ?? '') : '';
    items.push({ kind: 'char', at, char, code });
  }
  return items;
}

/**
 * The Letter_Trail (a visual-only addition from the demo design direction, see design.md
 * "Components"): the last few typed characters, each as its Morse glyph group with the letter
 * beneath, so the stream band reads like Morse tape and the live Symbol_Stream to its right
 * continues it. Groups sit 3u apart (the letter gap) and words 7u apart (3u, a 1u word-gap item,
 * 3u); a zero-width spacer leaves the same 3u gap before the live pattern.
 *
 * It is aria-hidden and holds no state. The row runs right to left from the newest group
 * (flex-row-reverse, newest first in the DOM), so when space runs out the oldest groups are
 * clipped at the left edge and the Symbol_Stream never shrinks. On the Composer_Panel the clip
 * edge lies in the panel padding under a fade (the trail-bleed utility), so a clipped group runs
 * off the stage softly and a trail that fits is drawn in full. A new group settles in, except
 * under reduced motion.
 */
export function LetterTrail({ text }: LetterTrailProps) {
  const items = trailItems(text);
  if (items.length === 0) return null;
  const newestFirst = [...items].reverse();

  return (
    <div
      aria-hidden="true"
      className="trail-bleed flex min-w-0 shrink flex-row-reverse items-start gap-x-[calc(var(--sym-u)*3)] overflow-hidden"
    >
      <span className="block w-0 shrink-0" />
      {newestFirst.map((item) =>
        item.kind === 'space' ? (
          <span key={item.at} role="separator" aria-label="word gap" className="block w-(--sym-u) shrink-0" />
        ) : (
          <span
            key={item.at}
            role="group"
            aria-label={item.char}
            className="flex shrink-0 flex-col items-center gap-[calc(var(--sym-u)*0.75)] motion-safe:animate-settle"
          >
            <span className="flex h-(--sym-u) items-center gap-(--sym-u)">
              {[...item.code].map((symbol, index) => (
                <span
                  key={index}
                  role="img"
                  aria-label={symbol === '.' ? 'dot' : 'dash'}
                  className={`block bg-muted ${symbol === '.' ? 'glyph-dot' : 'glyph-dash'}`}
                />
              ))}
            </span>
            <span className="text-lg leading-none font-medium text-muted">{item.char}</span>
          </span>
        ),
      )}
    </div>
  );
}
