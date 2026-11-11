/**
 * Panel placement beside the Keying_Surface (design "lib/onboarding/placement.ts", Requirements
 * 10.9, 14.2, 18.11): the largest band of the viewport above, below, left or right of the
 * Keying_Surface, kept 8 px away from it. Pure.
 */

export interface Rect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

export type Placement = { readonly kind: 'rect'; readonly rect: Rect } | { readonly kind: 'none' };

/** Space kept between a placed panel and the Keying_Surface. */
export const PANEL_GAP_PX = 8;

const NONE: Placement = Object.freeze({ kind: 'none' });

/** The four bands, each clamped to the viewport, in tie-break order: below, above, right, left. */
export function freeBands(viewport: Rect, keying: Rect, gap: number = PANEL_GAP_PX): readonly Rect[] {
  const vTop = viewport.top;
  const vLeft = viewport.left;
  const vBottom = viewport.top + viewport.height;
  const vRight = viewport.left + viewport.width;
  const kBottom = keying.top + keying.height;
  const kRight = keying.left + keying.width;

  const band = (top: number, left: number, bottom: number, right: number): Rect => {
    const t = Math.max(top, vTop);
    const l = Math.max(left, vLeft);
    return { top: t, left: l, width: Math.min(right, vRight) - l, height: Math.min(bottom, vBottom) - t };
  };
  return [
    band(kBottom + gap, vLeft, vBottom, vRight), // below
    band(vTop, vLeft, keying.top - gap, vRight), // above
    band(vTop, kRight + gap, vBottom, vRight), // right
    band(vTop, vLeft, vBottom, keying.left - gap), // left
  ];
}

/**
 * The largest band (by area) that is at least `minSize`, or `none` when no band is big enough.
 * The result lies inside the viewport and never intersects the Keying_Surface.
 */
export function placePanel(
  viewport: Rect,
  keying: Rect,
  minSize: { readonly width: number; readonly height: number },
): Placement {
  const values = [viewport.top, viewport.left, viewport.width, viewport.height, keying.top, keying.left, keying.width, keying.height];
  if (!values.every(Number.isFinite)) return NONE;
  let best: Rect | null = null;
  for (const band of freeBands(viewport, keying)) {
    if (band.width < minSize.width || band.height < minSize.height || band.width <= 0 || band.height <= 0) continue;
    if (best === null || band.width * band.height > best.width * best.height) best = band;
  }
  return best === null ? NONE : { kind: 'rect', rect: best };
}
