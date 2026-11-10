// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { createCheatSheetStore, type CheatSheetContext } from '@/lib/onboarding';
import { CommandLegend } from './CommandLegend';
import { createSessionRig, FakeKeyingSurface } from './onboarding.test-support';
import { SessionApiContext } from './session-api-context';

afterEach(cleanup);

const ENTRIES = [
  ['Speak: dot dash dot dash dot', 5],
  ['Next suggestion: dot dot dash dash', 4],
  ['Delete last letter: dash dash dash dash', 4],
  ['Help alarm: dot dot dot dash dash dash dot dot dot', 9],
] as const;

function renderLegend() {
  const ctx: { -readonly [K in keyof CheatSheetContext]: CheatSheetContext[K] } = { onboardingOpen: false, alarmActive: false };
  const store = createCheatSheetStore(() => ctx);
  const session = createSessionRig();
  const tree = () => (
    <SessionApiContext value={session.value}>
      <FakeKeyingSurface />
      <aside aria-label="Commands">
        <CommandLegend store={store} />
      </aside>
    </SessionApiContext>
  );
  const view = render(tree());
  return { ctx, store, session, rerender: () => view.rerender(tree()) };
}

const items = (): HTMLElement[] => within(screen.getByRole('list', { name: 'Command codes' })).getAllByRole('listitem');

describe('CommandLegend', () => {
  it('lists the 4 commands in order, each read once as its label and spoken code', () => {
    renderLegend();
    expect(items()).toHaveLength(4);
    items().forEach((item, index) => {
      const [text] = ENTRIES[index] ?? [];
      if (text === undefined) throw new Error('entry expected');
      expect(within(item).getByText(text)).toBeDefined();
    });
  });

  it('draws one aria-hidden glyph per symbol of each code', () => {
    renderLegend();
    items().forEach((item, index) => {
      expect(within(item).queryAllByRole('img')).toHaveLength(0);
      expect(within(item).getAllByRole('img', { hidden: true })).toHaveLength(ENTRIES[index]?.[1] ?? -1);
    });
  });

  it('"All codes" opens the sheet for the partner and focuses the Keying_Surface, with no press', async () => {
    const { store, session } = renderLegend();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'All codes' }));
    expect(store.getState()).toEqual({ open: true, reason: 'partner', pattern: null });
    expect(session.focusKeyingSurface).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keying surface' }));
    expect(session.handlePress).not.toHaveBeenCalled();
  });

  it('"All codes" turns an open unknown sheet into a partner sheet and keeps its pattern', async () => {
    const { store } = renderLegend();
    act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
    await userEvent.setup().click(screen.getByRole('button', { name: 'All codes' }));
    expect(store.getState()).toEqual({ open: true, reason: 'partner', pattern: '......' });
  });

  it('shows the same content while onboarding is open and while the alarm rings', () => {
    const { ctx, store, rerender } = renderLegend();
    const html = (): string => screen.getByRole('list', { name: 'Command codes' }).outerHTML;
    const before = html();
    for (const flags of [
      { onboardingOpen: true, alarmActive: false },
      { onboardingOpen: false, alarmActive: true },
      { onboardingOpen: true, alarmActive: true },
    ]) {
      Object.assign(ctx, flags);
      act(() => store.dispatch({ type: 'unknown', pattern: '.-.-.-.-.-' }));
      rerender();
      expect(html()).toBe(before);
    }
  });
});
