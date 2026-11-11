// @vitest-environment jsdom
import { cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingAction } from '@/lib/onboarding';
import { LegendStep } from './LegendStep';

afterEach(cleanup);

const ENTRIES = [
  ['Speak', 'dot dash dot dash dot', 'Says the highlighted suggestion, or the typed text when nothing is highlighted.'],
  ['Next suggestion', 'dot dot dash dash', 'Moves the highlight to the next suggestion.'],
  ['Delete last letter', 'dash dash dash dash', 'Deletes the last letter.'],
  ['Help alarm', 'dot dot dot dash dash dash dot dot dot', 'Sounds an alarm and shows I need help until any press.'],
] as const;

describe('LegendStep', () => {
  it('shows the 4 commands in legend order with their glyphs, spoken code and one sentence each', () => {
    render(<LegendStep dispatch={vi.fn()} />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items).toHaveLength(4);
    items.forEach((item, index) => {
      const [label, spoken, sentence] = ENTRIES[index] ?? [];
      if (label === undefined || spoken === undefined || sentence === undefined) throw new Error('entry expected');
      expect(within(item).getByText(label)).toBeDefined();
      expect(within(item).getByText(spoken)).toBeDefined();
      expect(within(item).getByText(sentence)).toBeDefined();
      expect(within(item).queryAllByRole('img')).toHaveLength(0);
      expect(within(item).getAllByRole('img', { hidden: true })).toHaveLength(spoken.split(' ').length);
    });
  });

  it('shows the All codes hint and Start, which dispatches start', async () => {
    const dispatch = vi.fn<(action: OnboardingAction) => void>();
    render(<LegendStep dispatch={dispatch} />);
    expect(screen.getByText('Tap All codes, or key a pattern that is not a code, to see every letter.')).toBeDefined();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Start' }));
    expect(dispatch.mock.calls).toEqual([[{ type: 'start' }]]);
  });
});
