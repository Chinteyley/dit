// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveRegion } from './LiveRegion';

afterEach(cleanup);

const regions = (): Element[] => [...document.querySelectorAll('[aria-live]')];

describe('LiveRegion', () => {
  it('is exactly one polite, atomic live region (Req 12.8)', () => {
    render(<LiveRegion announcement={null} />);
    const all = regions();
    expect(all).toHaveLength(1);
    expect(all[0]?.getAttribute('aria-live')).toBe('polite');
    expect(all[0]?.getAttribute('aria-atomic')).toBe('true');
    expect(all[0]?.textContent).toBe('');
  });

  it('renders the announcement text', () => {
    render(<LiveRegion announcement={{ seq: 2, text: 'h, i, space' }} />);
    expect(regions()[0]?.textContent).toBe('h, i, space');
  });

  it('changes its text for the same announcement with a new seq, so it is read again (Req 12.8)', () => {
    const view = render(<LiveRegion announcement={{ seq: 1, text: '1 suggestion' }} />);
    const first = regions()[0]?.textContent;
    view.rerender(<LiveRegion announcement={{ seq: 2, text: '1 suggestion' }} />);
    const second = regions()[0]?.textContent;
    expect(first).not.toBe(second);
    expect(first?.startsWith('1 suggestion')).toBe(true);
    expect(second?.startsWith('1 suggestion')).toBe(true);
    expect(regions()).toHaveLength(1);
  });
});
