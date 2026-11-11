import { useLayoutEffect, useState } from 'react';
import { placePanel, type Rect } from '@/lib/onboarding';

/** The Keying_Surface, found by its stable role and name (conversation-ui Requirement 10). */
export const KEYING_SURFACE_SELECTOR = '[role="button"][aria-label="Keying surface"]';

export interface PanelSize {
  readonly width: number;
  readonly height: number;
}

function viewportRect(): Rect {
  // clientWidth leaves out a classic vertical scrollbar; innerWidth is the fallback.
  const width = document.documentElement.clientWidth || window.innerWidth;
  return { top: 0, left: 0, width, height: window.innerHeight };
}

function surfaceRect(surface: Element | null): Rect {
  if (surface === null) return { top: 0, left: 0, width: 0, height: 0 };
  const box = surface.getBoundingClientRect();
  return { top: box.top, left: box.left, width: box.width, height: box.height };
}

function measure(minSize: PanelSize, allowScroll: boolean): Rect {
  const surface = document.querySelector(KEYING_SURFACE_SELECTOR);
  const placed = placePanel(viewportRect(), surfaceRect(surface), minSize);
  if (placed.kind === 'rect') return placed.rect;
  // No band is big enough: bring the Keying_Surface to the bottom edge and use the band above it.
  if (allowScroll && surface !== null) surface.scrollIntoView({ block: 'end' });
  const viewport = viewportRect();
  const keying = surfaceRect(surface);
  const again = placePanel(viewport, keying, minSize);
  if (again.kind === 'rect') return again.rect;
  return bottomSheet(viewport, minSize);
}

/**
 * The fallback when no free band fits the panel (a short or narrow window): a sheet along the
 * bottom edge, as tall as the panel needs but at most 72% of the viewport, so the top of the
 * Keying_Surface stays visible and pressable and the panel is never cut off.
 */
function bottomSheet(viewport: Rect, minSize: PanelSize): Rect {
  const height = Math.max(0, Math.round(Math.min(minSize.height, viewport.height * 0.72)));
  return { top: viewport.top + viewport.height - height, left: viewport.left, width: viewport.width, height };
}

/**
 * Where a fixed panel (the Cheat_Sheet, the Practice_Step) goes while `active`: the largest free
 * band of the viewport beside the Keying_Surface (onboarding-and-safety design "placement.ts",
 * Requirements 10.9, 14.2, 18.11). It is measured before paint and again on every resize,
 * orientation change, scroll and Keying_Surface size change. Null while inactive.
 */
export function usePanelPlacement(active: boolean, minSize: PanelSize): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null);
  const { width, height } = minSize;

  useLayoutEffect(() => {
    if (!active) return;
    const size = { width, height };
    let frame: number | null = null;
    // A new object only when the band moved, so a scroll that changes nothing renders nothing.
    const place = (allowScroll: boolean): void => {
      const next = measure(size, allowScroll);
      setRect((previous) =>
        previous !== null &&
        previous.top === next.top &&
        previous.left === next.left &&
        previous.width === next.width &&
        previous.height === next.height
          ? previous
          : next,
      );
    };
    const schedule = (): void => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        place(false);
      });
    };
    place(true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { capture: true, passive: true });
    const surface = document.querySelector(KEYING_SURFACE_SELECTOR);
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    if (surface !== null) observer?.observe(surface);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, { capture: true });
      observer?.disconnect();
      setRect(null);
    };
  }, [active, width, height]);

  return active ? rect : null;
}
