export interface LiveRegionProps {
  readonly announcement: { readonly seq: number; readonly text: string } | null;
}

/** Toggled by seq parity, so the same text twice in a row still changes the region and is re-read. */
const ZERO_WIDTH_SPACE = '\u200B';

/**
 * The Live_Region (Requirement 12): the page's only aria-live element. The controller throttles
 * and coalesces what it says (at most one announcement per second, committed characters and new
 * suggestions only), so this component just renders the latest announcement.
 */
export function LiveRegion({ announcement }: LiveRegionProps) {
  const text = announcement === null ? '' : `${announcement.text}${announcement.seq % 2 === 1 ? ZERO_WIDTH_SPACE : ''}`;
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {text}
    </div>
  );
}
