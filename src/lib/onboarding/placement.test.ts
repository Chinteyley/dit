import { describe, expect, it } from 'vitest';
import { PANEL_GAP_PX, freeBands, placePanel, type Rect } from './placement';

const VIEWPORT: Rect = { top: 0, left: 0, width: 1024, height: 768 };
const MIN = { width: 280, height: 200 };

describe('placePanel', () => {
  it('uses the larger band above a Keying_Surface at the bottom of the screen', () => {
    const keying: Rect = { top: 500, left: 0, width: 1024, height: 268 };
    expect(placePanel(VIEWPORT, keying, MIN)).toEqual({
      kind: 'rect',
      rect: { top: 0, left: 0, width: 1024, height: 500 - PANEL_GAP_PX },
    });
  });

  it('uses the band to the right of a Keying_Surface on the left half', () => {
    const keying: Rect = { top: 0, left: 0, width: 600, height: 768 };
    expect(placePanel(VIEWPORT, keying, MIN)).toEqual({
      kind: 'rect',
      rect: { top: 0, left: 608, width: 416, height: 768 },
    });
  });

  it('returns none when no band is big enough', () => {
    const keying: Rect = { top: 100, left: 100, width: 824, height: 568 };
    expect(placePanel(VIEWPORT, keying, MIN)).toEqual({ kind: 'none' });
  });

  it('clamps bands to the viewport when the Keying_Surface is partly off-screen', () => {
    const keying: Rect = { top: -200, left: 0, width: 1024, height: 500 };
    const placed = placePanel(VIEWPORT, keying, MIN);
    expect(placed).toEqual({ kind: 'rect', rect: { top: 308, left: 0, width: 1024, height: 460 } });
  });

  it('works for a viewport that does not start at 0', () => {
    const viewport: Rect = { top: 50, left: 20, width: 800, height: 600 };
    const keying: Rect = { top: 50, left: 20, width: 800, height: 200 };
    expect(placePanel(viewport, keying, MIN)).toEqual({
      kind: 'rect',
      rect: { top: 258, left: 20, width: 800, height: 392 },
    });
  });

  it('returns none for non-finite input', () => {
    expect(placePanel(VIEWPORT, { top: Number.NaN, left: 0, width: 10, height: 10 }, MIN)).toEqual({ kind: 'none' });
  });

  it('lists the bands below, above, right and left', () => {
    const keying: Rect = { top: 300, left: 400, width: 200, height: 100 };
    expect(freeBands(VIEWPORT, keying)).toEqual([
      { top: 408, left: 0, width: 1024, height: 360 },
      { top: 0, left: 0, width: 1024, height: 292 },
      { top: 0, left: 608, width: 416, height: 768 },
      { top: 0, left: 0, width: 392, height: 768 },
    ]);
  });
});
