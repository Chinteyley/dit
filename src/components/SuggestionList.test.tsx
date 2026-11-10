// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SuggestionSource } from '@/lib/conversation';
import { INERT_SESSION_API, SessionApiContext } from './session-api-context';
import { SuggestionList } from './SuggestionList';

afterEach(cleanup);

const SUGGESTIONS = ['I want to go outside.', 'I want to get out.', 'Is it time to go?'] as const;

function renderList(
  props: {
    readonly suggestions?: readonly string[];
    readonly source?: SuggestionSource | null;
    readonly highlight?: number | null;
    readonly currentText?: string;
  } = {},
) {
  const calls: string[] = [];
  const onPick = vi.fn((index: number) => calls.push(`pick ${index}`));
  const focusKeyingSurface = vi.fn(() => calls.push('focus'));
  const suggestions = props.suggestions ?? SUGGESTIONS;
  const wrap = (node: ReactNode) => (
    <SessionApiContext value={{ ...INERT_SESSION_API, focusKeyingSurface }}>{node}</SessionApiContext>
  );
  render(
    wrap(
      <SuggestionList
        suggestions={suggestions}
        source={props.source === undefined ? (suggestions.length > 0 ? 'ai' : null) : props.source}
        highlight={props.highlight === undefined ? 0 : props.highlight}
        currentText={props.currentText ?? 'i w t g o'}
        onPick={onPick}
      />,
    ),
  );
  return { onPick, focusKeyingSurface, calls };
}

describe('SuggestionList', () => {
  it('shows one button per suggestion, in order, named by its text (Req 13.1)', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Suggestions' });
    const buttons = within(list).getAllByRole('button');
    expect(buttons.map((button) => button.textContent)).toStrictEqual([...SUGGESTIONS]);
    for (const text of SUGGESTIONS) expect(screen.getByRole('button', { name: text })).toBeDefined();
  });

  it('marks exactly the highlighted suggestion with aria-current and "Will be spoken" (Req 13.2, 13.3)', () => {
    renderList({ highlight: 1 });
    const current = screen.getAllByRole('button').filter((button) => button.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(screen.getByRole('button', { name: SUGGESTIONS[1] }));
    expect(screen.getByText('Will be spoken')).toBeDefined();
    expect(screen.queryByText('Your typed text will be spoken')).toBeNull();
  });

  it('marks nothing when Highlight is none, and says the typed text will be spoken (Req 13.4)', () => {
    renderList({ highlight: null });
    expect(screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-current'))).toHaveLength(0);
    expect(screen.queryByText('Will be spoken')).toBeNull();
    expect(screen.getByText('Your typed text will be spoken')).toBeDefined();
  });

  it('labels the source "AI" or "On-device" (Req 13.5)', () => {
    renderList({ source: 'ai' });
    expect(screen.getByText('Source: AI')).toBeDefined();
    cleanup();
    renderList({ source: 'on-device' });
    expect(screen.getByText('Source: On-device')).toBeDefined();
    expect(screen.queryByText('Source: AI')).toBeNull();
  });

  it('shows no buttons and no source without suggestions (Req 13.6)', () => {
    renderList({ suggestions: [], source: null, highlight: null });
    expect(within(screen.getByRole('list', { name: 'Suggestions' })).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText(/^Source:/)).toBeNull();
  });

  it('shows the hint only when there are no suggestions and no text (Req 13.8, 13.9)', () => {
    renderList({ suggestions: [], source: null, highlight: null, currentText: '' });
    expect(screen.getByText('Tap a suggestion to speak it')).toBeDefined();
    cleanup();
    renderList({ suggestions: [], source: null, highlight: null, currentText: 'h' });
    expect(screen.queryByText('Tap a suggestion to speak it')).toBeNull();
    cleanup();
    renderList({ currentText: '' });
    expect(screen.queryByText('Tap a suggestion to speak it')).toBeNull();
  });

  it('picks the clicked suggestion once, then returns focus to the Keying_Surface (Req 13.7, 21.1)', async () => {
    const user = userEvent.setup();
    const { onPick, calls } = renderList();
    await user.click(screen.getByRole('button', { name: SUGGESTIONS[2] }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenCalledWith(2);
    expect(calls).toStrictEqual(['pick 2', 'focus']);
  });

  it('picks with Enter and with Space as well', async () => {
    const user = userEvent.setup();
    const { onPick, calls } = renderList();
    screen.getByRole('button', { name: SUGGESTIONS[1] }).focus();
    await user.keyboard('{Enter}');
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick).toHaveBeenLastCalledWith(1);
    await user.keyboard(' ');
    expect(onPick).toHaveBeenCalledTimes(2);
    expect(calls).toStrictEqual(['pick 1', 'focus', 'pick 1', 'focus']);
  });
});
