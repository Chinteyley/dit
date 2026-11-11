import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PANEL_GAP_PX, placePanel, type Rect } from './placement';
import { PROP_RUNS, arbPlacementInput } from './test-support';

const EPSILON = 1e-6;

const intersects = (a: Rect, b: Rect): boolean =>
  a.left < b.left + b.width && a.left + a.width > b.left && a.top < b.top + b.height && a.top + a.height > b.top;

describe('Panel placement properties', () => {
  // Feature: onboarding-and-safety, Property 17: Placed panels never cover the Keying_Surface
  it('P17 placed panels never cover the keying surface', () => {
    fc.assert(
      fc.property(arbPlacementInput(), ({ viewport, keying, minSize }) => {
        const placed = placePanel(viewport, keying, minSize);
        const vBottom = viewport.top + viewport.height;
        const vRight = viewport.left + viewport.width;
        // The free space on each side, measured independently of placePanel.
        const above = keying.top - PANEL_GAP_PX - viewport.top;
        const below = vBottom - (keying.top + keying.height + PANEL_GAP_PX);
        const left = keying.left - PANEL_GAP_PX - viewport.left;
        const right = vRight - (keying.left + keying.width + PANEL_GAP_PX);
        const someBandFits =
          (viewport.width >= minSize.width && (above >= minSize.height || below >= minSize.height)) ||
          (viewport.height >= minSize.height && (left >= minSize.width || right >= minSize.width));

        if (placed.kind === 'none') {
          expect(someBandFits).toBe(false);
          return;
        }
        const r = placed.rect;
        expect(r.top).toBeGreaterThanOrEqual(viewport.top - EPSILON);
        expect(r.left).toBeGreaterThanOrEqual(viewport.left - EPSILON);
        expect(r.top + r.height).toBeLessThanOrEqual(vBottom + EPSILON);
        expect(r.left + r.width).toBeLessThanOrEqual(vRight + EPSILON);
        expect(intersects(r, keying)).toBe(false);
        expect(r.width).toBeGreaterThanOrEqual(minSize.width);
        expect(r.height).toBeGreaterThanOrEqual(minSize.height);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
