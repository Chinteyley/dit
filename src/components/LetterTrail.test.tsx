// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { CHARACTER_TABLE } from '@/lib/morse';
import { LetterTrail } from './LetterTrail';

afterEach(cleanup);

/** Groups in typed order. The trail lays out right to left from the newest, so the DOM holds them newest first. */
function groupsInTypedOrder(): HTMLElement[] {
  return screen.getAllByRole('group', { hidden: true }).reverse();
}

const glyphNames = (group: HTMLElement): string[] =>
  within(group)
    .queryAllByRole('img', { hidden: true })
    .map((glyph) => glyph.getAttribute('aria-label') ?? '');

const codeAsNames = (code: string): string[] => [...code].map((symbol) => (symbol === '.' ? 'dot' : 'dash'));

describe('LetterTrail', () => {
  it('is hidden from assistive technology', () => {
    render(<LetterTrail text="sos" />);
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    expect(screen.getAllByRole('group', { hidden: true })).toHaveLength(3);
  });

  it('draws one group per recent character, in typed order, with the letter beneath its code', () => {
    render(<LetterTrail text="hi there" />);
    const groups = groupsInTypedOrder();
    expect(groups.map((group) => group.textContent)).toStrictEqual(['h', 'i', 't', 'h', 'e', 'r', 'e']);
    for (const group of groups) {
      const char = group.textContent ?? '';
      expect(glyphNames(group), char).toStrictEqual(codeAsNames(CHARACTER_TABLE[char] ?? ''));
    }
  });

  it('puts a word gap between words and none between letters', () => {
    render(<LetterTrail text="hi there" />);
    const gaps = screen.getAllByRole('separator', { hidden: true, name: 'word gap' });
    expect(gaps).toHaveLength(1);
    const [gap] = gaps;
    const [, i, t] = groupsInTypedOrder();
    // Newest first in the DOM: the gap sits between "t" (before it) and "i" (after it).
    expect(gap?.previousElementSibling).toBe(t);
    expect(gap?.nextElementSibling).toBe(i);
  });

  it('ends with a word gap after a trailing space, so the live pattern starts a new word', () => {
    render(<LetterTrail text="i w " />);
    expect(groupsInTypedOrder().map((group) => group.textContent)).toStrictEqual(['i', 'w']);
    expect(screen.getAllByRole('separator', { hidden: true, name: 'word gap' })).toHaveLength(2);
  });

  it('keeps only the most recent characters of a long text', () => {
    const text = `${'e'.repeat(40)}abc`;
    render(<LetterTrail text={text} />);
    const groups = groupsInTypedOrder();
    expect(groups.length).toBeLessThan(text.length);
    expect(groups.slice(-3).map((group) => group.textContent)).toStrictEqual(['a', 'b', 'c']);
  });

  it('draws a character with no code as the bare letter', () => {
    render(<LetterTrail text="a+" />);
    const [a, plus] = groupsInTypedOrder();
    expect(glyphNames(a as HTMLElement)).toStrictEqual(['dot', 'dash']);
    expect(plus?.textContent).toBe('+');
    expect(glyphNames(plus as HTMLElement)).toStrictEqual([]);
  });

  it('renders nothing for empty text', () => {
    const { container } = render(<LetterTrail text="" />);
    expect(container.childElementCount).toBe(0);
  });
});
