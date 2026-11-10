import { useEffect, useId, type RefObject } from 'react';

export interface KeyingSurfaceProps {
  /** Element id, so DitApp's focus helper can find the surface without holding a ref. */
  readonly id?: string;
  /** The last Press_Event was a `down` (any source, alarm or not). */
  readonly pressed: boolean;
  /** The input layer listens on this element (pointer source) and DitApp focuses it (Req 21). */
  readonly ref: RefObject<HTMLDivElement | null>;
}

/**
 * The Keying_Surface (Requirement 10): the largest target on screen. A div with role="button"
 * rather than a <button>, so Space and Enter never fire a click; the keyboard source keys them.
 * Pressed and idle differ in fill and border width and switch with no transition. The dashed
 * amber focus ring from globals.css sits outside the border, so a focused idle surface never
 * looks pressed. The description is also shown, as a caption, for whoever is watching.
 */
export function KeyingSurface({ id, pressed, ref }: KeyingSurfaceProps) {
  const hintId = useId();

  // The main screen opens with focus here (Req 10.2), without scrolling the page.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [ref]);

  return (
    <div
      ref={ref}
      id={id}
      role="button"
      tabIndex={0}
      aria-label="Keying surface"
      aria-describedby={hintId}
      data-pressed={pressed ? 'true' : 'false'}
      onContextMenu={(event) => event.preventDefault()}
      // One column: at least 40vh (30vh from 768 px). Two columns: it fills the rest of the viewport
      // height, at least 12rem, so it stays on screen while three suggestions show.
      className="flex min-h-[max(40vh,12rem)] w-full flex-1 cursor-pointer touch-none select-none items-end rounded-3xl border-2 border-border bg-raised p-6 text-muted [-webkit-touch-callout:none] [-webkit-user-select:none] md:min-h-[max(30vh,12rem)] wide:min-h-48 data-[pressed=true]:border-(length:--border-pressed) data-[pressed=true]:border-text data-[pressed=true]:bg-accent data-[pressed=true]:text-on-accent"
    >
      <span id={hintId} className="max-w-[36ch] text-lg text-pretty">
        Press to key Morse: short for dot, long for dash.
      </span>
    </div>
  );
}
