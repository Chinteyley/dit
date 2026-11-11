// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCheatSheetModel, entryAccessibleText, createCheatSheetStore, type CheatSheetContext } from '@/lib/onboarding';
import { CheatSheet } from './CheatSheet';
import { createSessionRig, FakeKeyingSurface, KEYING_SURFACE } from './onboarding.test-support';
import { SessionApiContext } from './session-api-context';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function renderSheet() {
  const ctx: { -readonly [K in keyof CheatSheetContext]: CheatSheetContext[K] } = { onboardingOpen: false, alarmActive: false };
  const store = createCheatSheetStore(() => ctx);
  const session = createSessionRig();
  const settingsRef = createRef<HTMLDialogElement>();
  render(
    <SessionApiContext value={session.value}>
      <h1>Dit</h1>
      <FakeKeyingSurface />
      <CheatSheet store={store} />
      <button type="button">After the sheet</button>
      <dialog ref={settingsRef} aria-label="Settings">
        <button type="button">Settings control</button>
      </dialog>
    </SessionApiContext>,
  );
  const settings = (): HTMLDialogElement => {
    if (settingsRef.current === null) throw new Error('settings dialog not mounted');
    return settingsRef.current;
  };
  return { ctx, store, session, settings };
}

const region = (): HTMLElement => screen.getByRole('region', { name: 'All codes' });
const surface = (): HTMLElement => screen.getByRole('button', KEYING_SURFACE);

describe('CheatSheet', () => {
  it('renders nothing while closed', () => {
    renderSheet();
    expect(screen.queryByRole('region', { name: 'All codes' })).toBeNull();
  });

  it('pages through every character and command with six dots alone', () => {
    const { store } = renderSheet();
    act(() => store.dispatch({ type: 'partner-open' }));
    const allEntries = buildCheatSheetModel().flatMap((group) => group.entries);
    const seen = new Set<string>();
    for (let page = 0; page < Math.ceil(allEntries.length / 8); page += 1) {
      const sheet = region();
      expect(within(sheet).getAllByRole('listitem').length).toBeLessThanOrEqual(8);
      for (const entry of allEntries) if (within(sheet).queryByText(entryAccessibleText(entry))) seen.add(entry.code);
      act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
    }
    expect(seen.size).toBe(allEntries.length);
    expect(within(region()).getByText('A dot dash')).toBeDefined();
  });

  it('shows the unknown pattern under "Not a code:" only for an unknown opening, and the newest one', () => {
    const { store } = renderSheet();
    act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
    expect(within(region()).getByText(/^Not a code:/)).toBeDefined();
    expect(within(region()).getByText('dot dot dot dot dot dot')).toBeDefined();
    act(() => store.dispatch({ type: 'unknown', pattern: '-.-.-.-' }));
    expect(within(region()).queryByText('dot dot dot dot dot dot')).toBeNull();
    expect(within(region()).getByText('dash dot dash dot dash dot dash')).toBeDefined();
    act(() => store.dispatch({ type: 'close' }));
    act(() => store.dispatch({ type: 'partner-open' }));
    expect(within(region()).queryByText(/Not a code:/)).toBeNull();
  });

  it('opens without moving focus, lets Tab leave, and makes nothing else inert or hidden', async () => {
    const { store } = renderSheet();
    surface().focus();
    act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
    expect(document.activeElement).toBe(surface());
    expect(region().getAttribute('aria-modal')).toBeNull();
    const user = userEvent.setup();
    within(region()).getByRole('button', { name: 'Close codes' }).focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'After the sheet' }));
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    for (const hidden of document.querySelectorAll('[aria-hidden="true"]')) expect(region().contains(hidden)).toBe(true);
  });

  it('"Close codes" closes it and focuses the Keying_Surface', async () => {
    const { store, session } = renderSheet();
    act(() => store.dispatch({ type: 'partner-open' }));
    await userEvent.setup().click(within(region()).getByRole('button', { name: 'Close codes' }));
    expect(screen.queryByRole('region', { name: 'All codes' })).toBeNull();
    expect(session.focusKeyingSurface).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(surface());
  });

  it('Escape closes it and focuses the Keying_Surface, but not while a modal dialog is open', () => {
    const { store, settings } = renderSheet();
    act(() => store.dispatch({ type: 'partner-open' }));
    act(() => settings().showModal());
    fireEvent.keyDown(within(settings()).getByRole('button', { name: 'Settings control' }), { key: 'Escape' });
    // The Escape closed Settings (the newest modal) and left the sheet open.
    expect(settings().open).toBe(false);
    expect(region()).toBeDefined();
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'All codes' })).toBeNull();
    expect(document.activeElement).toBe(surface());
  });

  it('stays open on Escape while the alarm is active', () => {
    const { ctx, store, session } = renderSheet();
    act(() => store.dispatch({ type: 'partner-open' }));
    ctx.alarmActive = true;
    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(region()).toBeDefined();
    expect(session.focusKeyingSurface).not.toHaveBeenCalled();
  });

  it('a committed character or command closes either opening', () => {
    const { store, session } = renderSheet();
    act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
    act(() => session.commitChar('e'));
    expect(screen.queryByRole('region', { name: 'All codes' })).toBeNull();
    // Focus was not inside the sheet, so it stays where it was.
    expect(session.focusKeyingSurface).not.toHaveBeenCalled();
    act(() => store.dispatch({ type: 'partner-open' }));
    act(() => session.commitChar('next'));
    expect(screen.queryByRole('region', { name: 'All codes' })).toBeNull();
  });

  it('moves focus to the Keying_Surface when a committed character closes the sheet it was in', () => {
    const { store, session } = renderSheet();
    act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
    within(region()).getByRole('button', { name: 'Close codes' }).focus();
    act(() => session.commitChar('t'));
    expect(screen.queryByRole('region', { name: 'All codes' })).toBeNull();
    expect(document.activeElement).toBe(surface());
  });

  it('is placed in a band beside the Keying_Surface and scrolls inside', () => {
    const { store } = renderSheet();
    act(() => store.dispatch({ type: 'partner-open' }));
    // jsdom lays nothing out: the Keying_Surface is a 0 by 0 box at the origin of the 1024 by 768
    // viewport, so the band to its right (8 px away, 1016 by 768) is the largest.
    const style = region().style;
    expect([style.top, style.left, style.width, style.height]).toEqual(['0px', '8px', '1016px', '768px']);
  });
});

it.each([[1280, 800], [820, 1180], [393, 852]])('makes every code reachable by single-input paging at %i×%i', (width, height) => {
  vi.stubGlobal('innerWidth', width);
  vi.stubGlobal('innerHeight', height);
  const { store } = renderSheet();
  act(() => store.dispatch({ type: 'partner-open' }));
  const entries = buildCheatSheetModel().flatMap((group) => group.entries);
  const seen = new Set<string>();
  const pagesText = within(region()).getByText(/^Page 1 of/).textContent ?? '';
  const pages = Number(/of (\d+)/.exec(pagesText)?.[1]);
  expect(pages).toBeGreaterThan(1);
  for (let i = 0; i < pages; i += 1) {
    expect(within(region()).getAllByRole('listitem').length).toBeLessThanOrEqual(8);
    for (const entry of entries) if (within(region()).queryByText(entryAccessibleText(entry))) seen.add(entry.code);
    act(() => store.dispatch({ type: 'unknown', pattern: '......' }));
  }
  expect(seen.size).toBe(entries.length);
  expect(within(region()).getByText(/^Page 1 of/)).toBeDefined();
});
