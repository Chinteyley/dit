// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SymbolStream } from './SymbolStream';

afterEach(cleanup);

const shapeNames = (): string[] =>
  screen.queryAllByRole('img', { hidden: true }).map((shape) => shape.getAttribute('aria-label') ?? '');

describe('SymbolStream', () => {
  it('names the pattern as words in keyed order (Req 11.6)', () => {
    render(<SymbolStream pattern=".-." />);
    expect(screen.getByText('dot dash dot')).toBeDefined();
    expect(shapeNames()).toStrictEqual(['dot', 'dash', 'dot']);
  });

  it('has an empty text alternative and no shapes for an empty pattern (Req 11.3, 11.6)', () => {
    const { container } = render(<SymbolStream pattern="" />);
    expect(shapeNames()).toStrictEqual([]);
    expect(container.textContent).toBe('');
  });

  it('hides the shapes from the accessibility tree (Req 11.6)', () => {
    render(<SymbolStream pattern="-.-." />);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getAllByRole('img', { hidden: true })).toHaveLength(4);
  });

  it('is not inside a live region and is not one (Req 11.7)', () => {
    render(<SymbolStream pattern="..." />);
    const text = screen.getByText('dot dot dot');
    expect(text.closest('[aria-live]')).toBeNull();
    for (const shape of screen.getAllByRole('img', { hidden: true })) expect(shape.closest('[aria-live]')).toBeNull();
  });

  it('draws twelve symbols for a twelve-symbol pattern (Req 11.4)', () => {
    render(<SymbolStream pattern={'-'.repeat(12)} />);
    expect(shapeNames()).toStrictEqual(Array<string>(12).fill('dash'));
    expect(screen.getByText(Array<string>(12).fill('dash').join(' '))).toBeDefined();
  });
});
