import { useEffect, useId, type ReactNode, type RefObject } from 'react';

export interface KeyingSurfaceProps {
  /** Element id, so DitApp's focus helper can find the surface without holding a ref. */
  readonly id?: string;
  /** The last Press_Event was a `down` (any source, alarm or not). */
  readonly pressed: boolean;
  /** The input layer listens on this element (pointer source) and DitApp focuses it (Req 21). */
  readonly ref: RefObject<HTMLDivElement | null>;
  /** Drawn on the Composer_Panel (the Partner_Display and the Stream_Band); presses pass through it. */
  readonly children?: ReactNode;
}

/**
 * The Composer_Panel frame (Requirements 10, 24.5 and 25, design "Components"). The Keying_Surface
 * element fills the frame and draws the stage: a div with role="button" rather than a <button>,
 * so Space and Enter never fire a click (the keyboard source keys them). Its children are drawn
 * in a sibling layer on top, never inside the button, because a button's children are
 * presentational and their headings would be lost to assistive technology. That layer lets every
 * pointer press through to the Keying_Surface and selects no text.
 *
 * A press changes nothing here: the stage keeps its fill, boundary and size, and only the
 * Press_Indicator in the Stream_Band shows it (Req 10.5, 25.5). Focus shows as the Armed_Edge, a
 * solid near-white 2 px outline drawn on the inside edge, so nothing moves (Req 10.6, 25.7). The
 * frame has no overflow clip, which would cut that edge. The caption is the button's description:
 * it is hidden from assistive technology, so it is read once, as the description.
 */
export function KeyingSurface({ id, pressed, ref, children }: KeyingSurfaceProps) {
  const captionId = useId();

  // The main screen opens with focus here (Req 10.2), without scrolling the page.
  useEffect(() => {
    ref.current?.focus({ preventScroll: true });
  }, [ref]);

  return (
    // Wide_Layout: the frame takes the height the Suggestion_List leaves (flex-1). One column: its
    // content height, at least 16rem (20rem from 768 px) (design "Screen layout").
    <div className="relative flex min-h-64 flex-col md:min-h-80 wide:min-h-64 wide:flex-1 wide:short:min-h-56">
      <div
        ref={ref}
        id={id}
        role="button"
        tabIndex={0}
        aria-label="Keying surface"
        aria-describedby={captionId}
        data-pressed={pressed ? 'true' : 'false'}
        onContextMenu={(event) => event.preventDefault()}
        className="absolute inset-0 cursor-pointer touch-none select-none rounded-4xl border border-border bg-surface [-webkit-touch-callout:none] [-webkit-user-select:none] focus:outline-2 focus:-outline-offset-2 focus:outline-solid focus:outline-text"
      />
      {/* The padding is --stage-pad, so the Letter_Trail can fade out across it (trail-bleed). */}
      <div className="pointer-events-none relative z-10 flex flex-1 select-none flex-col gap-3 p-(--stage-pad) [--stage-pad:1.25rem] md:gap-4 md:[--stage-pad:2rem] wide:short:gap-3 wide:short:[--stage-pad:1.5rem]">
        {children}
        <p id={captionId} aria-hidden="true" className="mt-auto text-base text-balance text-muted">
          Press to key Morse: short for dot, long for dash.
        </p>
      </div>
    </div>
  );
}
