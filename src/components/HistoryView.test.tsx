// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionTurn } from '@/lib/conversation';
import { setReducedMotion } from './test-setup';
import { HistoryView } from './HistoryView';

/** jsdom has no Element.scrollTo; the spy records how the list scrolled. */
const scrollTo = vi.fn();

beforeEach(() => {
  scrollTo.mockClear();
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

const turn = (id: number, role: SessionTurn['role'], text = `line ${id}`): SessionTurn => ({ id, role, text });
const list = (): HTMLElement => screen.getByRole('list', { name: 'Conversation history' });
const behaviors = (): unknown[] =>
  scrollTo.mock.calls.map(([options]) => (options as ScrollToOptions | undefined)?.behavior);

describe('HistoryView', () => {
  it('shows one labelled bubble per Turn, oldest first (Req 15.1, 15.3)', () => {
    render(
      <HistoryView turns={[turn(1, 'partner', 'Are you thirsty?'), turn(2, 'speaker', 'Yes, water please.')]} hydrated />,
    );
    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0] as HTMLElement).getByText('Partner')).toBeDefined();
    expect(within(items[0] as HTMLElement).getByText('Are you thirsty?')).toBeDefined();
    expect(within(items[1] as HTMLElement).getByText('Speaker')).toBeDefined();
    expect(within(items[1] as HTMLElement).getByText('Yes, water please.')).toBeDefined();
  });

  it('shows the empty list and a message when there are no Turns (Req 15.8)', () => {
    render(<HistoryView turns={[]} hydrated />);
    expect(within(list()).queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByText('No conversation yet.')).toBeDefined();
  });

  it('renders exactly 200 bubbles after a capped append (Req 15.10)', () => {
    const full = Array.from({ length: 200 }, (_, i) => turn(i + 1, i % 2 === 0 ? 'speaker' : 'partner'));
    const view = render(<HistoryView turns={full} hydrated />);
    view.rerender(<HistoryView turns={[...full.slice(1), turn(201, 'speaker', 'newest')]} hydrated />);
    const items = within(list()).getAllByRole('listitem');
    expect(items).toHaveLength(200);
    expect(within(list()).queryByText('line 1')).toBeNull();
    expect(within(items[199] as HTMLElement).getByText('newest')).toBeDefined();
  });

  it('scrolls smoothly to a new Turn (Req 15.2)', () => {
    const view = render(<HistoryView turns={[turn(1, 'speaker')]} hydrated />);
    scrollTo.mockClear();
    view.rerender(<HistoryView turns={[turn(1, 'speaker'), turn(2, 'partner')]} hydrated />);
    expect(behaviors()).toStrictEqual(['smooth']);
  });

  it('scrolls without animation under reduced motion (Req 15.7)', () => {
    setReducedMotion(true);
    const view = render(<HistoryView turns={[turn(1, 'speaker')]} hydrated />);
    scrollTo.mockClear();
    view.rerender(<HistoryView turns={[turn(1, 'speaker'), turn(2, 'partner')]} hydrated />);
    expect(behaviors()).toStrictEqual(['auto']);
  });

  it('scrolls without animation to the newest hydrated Turn (Req 15.9)', () => {
    const view = render(<HistoryView turns={[]} hydrated={false} />);
    expect(scrollTo).not.toHaveBeenCalled();
    view.rerender(<HistoryView turns={[turn(1, 'partner'), turn(2, 'speaker')]} hydrated />);
    expect(behaviors()).toStrictEqual(['auto']);
    view.rerender(<HistoryView turns={[turn(1, 'partner'), turn(2, 'speaker'), turn(3, 'speaker')]} hydrated />);
    expect(behaviors()).toStrictEqual(['auto', 'smooth']);
  });

  it('does not scroll when the newest Turn stays the same', () => {
    const turns = [turn(1, 'speaker')];
    const view = render(<HistoryView turns={turns} hydrated />);
    scrollTo.mockClear();
    view.rerender(<HistoryView turns={[...turns]} hydrated />);
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
