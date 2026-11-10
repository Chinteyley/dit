// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyingSurface } from './KeyingSurface';

afterEach(cleanup);

function renderSurface(pressed: boolean) {
  const ref = createRef<HTMLDivElement>();
  const view = render(<KeyingSurface pressed={pressed} ref={ref} />);
  return { ref, view, surface: screen.getByRole('button', { name: 'Keying surface' }) };
}

describe('KeyingSurface', () => {
  it('is a button named "Keying surface" with a description, and takes focus on mount (Req 10.2)', () => {
    const { ref, surface } = renderSurface(false);
    expect(surface).toBe(ref.current);
    expect(surface.tabIndex).toBe(0);
    const describedBy = surface.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(describedBy)?.textContent).toBe('Press to key Morse: short for dot, long for dash.');
    expect(document.activeElement).toBe(surface);
  });

  it('shows the pressed state while pressed and the idle state after (Req 10.3, 10.4)', () => {
    const { ref, view, surface } = renderSurface(false);
    expect(surface.dataset['pressed']).toBe('false');
    view.rerender(<KeyingSurface pressed ref={ref} />);
    expect(screen.getByRole('button', { name: 'Keying surface' }).dataset['pressed']).toBe('true');
    view.rerender(<KeyingSurface pressed={false} ref={ref} />);
    expect(screen.getByRole('button', { name: 'Keying surface' }).dataset['pressed']).toBe('false');
  });

  it('prevents the context menu so a long press opens nothing (Req 10.7)', () => {
    const { surface } = renderSurface(false);
    const notCancelled = fireEvent.contextMenu(surface);
    expect(notCancelled).toBe(false);
  });

  it('is not a native button, so Space and Enter never click it', () => {
    const { surface } = renderSurface(false);
    expect(surface.tagName).toBe('DIV');
  });
});
