// @vitest-environment jsdom
import { cleanup, isInaccessible, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StreamBand, streamSpan } from './StreamBand';

afterEach(cleanup);

/** The Press_Indicator; it sits in an aria-hidden subtree, as the symbol shapes do. */
const indicator = (): HTMLElement => screen.getByRole('img', { name: 'Press indicator', hidden: true });
const shapeNames = (): string[] =>
  screen.queryAllByRole('img', { hidden: true }).map((shape) => shape.getAttribute('aria-label') ?? '');

function renderBand(props: { readonly text?: string; readonly pattern?: string; readonly pressed?: boolean } = {}) {
  const element = (next: typeof props) => (
    <StreamBand text={next.text ?? ''} pattern={next.pattern ?? ''} pressed={next.pressed ?? false} />
  );
  const view = render(element(props));
  return {
    /** The band's root element: the morse-scale container that carries --stream-span. */
    band: (): HTMLElement => view.container.firstElementChild as HTMLElement,
    rerender: (next: typeof props) => view.rerender(element(next)),
  };
}

describe('streamSpan', () => {
  it('is 2 for an empty pattern: the 1u gap and one unit of the Press_Indicator (Req 26.3)', () => {
    expect(streamSpan('')).toBe(2);
  });

  it('adds 1 per dot, 3.25 per dash and 1 per gap between symbols, plus 2 (Req 26.3)', () => {
    expect(streamSpan('.')).toBe(3);
    expect(streamSpan('-')).toBe(5.25);
    expect(streamSpan('.-')).toBe(7.25);
    expect(streamSpan('...---...')).toBe(25.75);
    expect(streamSpan('-'.repeat(12))).toBe(52);
  });
});

describe('StreamBand', () => {
  it('sets --stream-span on the band from Current_Pattern (Req 26.3)', () => {
    const { band, rerender } = renderBand();
    expect(band().style.getPropertyValue('--stream-span')).toBe('2');
    rerender({ pattern: '...---...' });
    expect(band().style.getPropertyValue('--stream-span')).toBe('25.75');
    rerender({ pattern: '-'.repeat(12) });
    expect(band().style.getPropertyValue('--stream-span')).toBe('52');
  });

  it('puts the Press_Indicator after the last live symbol, outside the Symbol_Stream (Req 26.1)', () => {
    renderBand({ text: 'e', pattern: '-.' });
    // The Symbol_Stream: its text alternative and its shapes share one root.
    const stream = screen.getByText('dash dot').parentElement as HTMLElement;
    const live = within(stream).getAllByRole('img', { hidden: true });
    expect(live.map((shape) => shape.getAttribute('aria-label'))).toStrictEqual(['dash', 'dot']);
    const last = live.at(-1) as HTMLElement;
    expect(last.compareDocumentPosition(indicator()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(stream.contains(indicator())).toBe(false);
    // Trail first (the "e" group), then the live pattern, then the indicator.
    expect(shapeNames()).toStrictEqual(['dot', 'dash', 'dot', 'Press indicator']);
  });

  it('hides the Press_Indicator from assistive technology (Req 25.3)', () => {
    renderBand({ pattern: '.' });
    expect(isInaccessible(indicator())).toBe(true);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('shows the pressed state on the Press_Indicator: idle, pressed, idle again (Req 10.3 to 10.5, 25.1, 25.2)', () => {
    const { rerender } = renderBand({ pattern: '.' });
    expect(indicator().dataset['state']).toBe('idle');
    rerender({ pattern: '.', pressed: true });
    expect(indicator().dataset['state']).toBe('pressed');
    rerender({ pattern: '.', pressed: false });
    expect(indicator().dataset['state']).toBe('idle');
  });

  it('draws a held press as a ring around a separate centre, so it never looks like a keyed dot (Req 25.1, 25.2)', () => {
    const { rerender } = renderBand({ pattern: '.' });
    // Idle: the ring alone, with nothing inside.
    expect(indicator().childElementCount).toBe(0);
    rerender({ pattern: '.', pressed: true });
    // Held: the same ring holds one centre disc; the symbols and their text are unchanged.
    expect(indicator().childElementCount).toBe(1);
    expect(shapeNames()).toStrictEqual(['dot', 'Press indicator']);
    expect(screen.getByText('dot')).toBeDefined();
    rerender({ pattern: '.', pressed: false });
    expect(indicator().childElementCount).toBe(0);
  });

  it('shows only the idle Press_Indicator with no text and no pattern', () => {
    renderBand();
    expect(shapeNames()).toStrictEqual(['Press indicator']);
    expect(indicator().dataset['state']).toBe('idle');
    expect(screen.queryAllByRole('group', { hidden: true })).toHaveLength(0);
  });

  it('keeps the Symbol_Stream text alternative, outside any live region (Req 11.6, 11.7)', () => {
    renderBand({ text: 'so', pattern: '...' });
    const words = screen.getByText('dot dot dot');
    expect(words.closest('[aria-live]')).toBeNull();
    expect(isInaccessible(words)).toBe(false);
  });
});
