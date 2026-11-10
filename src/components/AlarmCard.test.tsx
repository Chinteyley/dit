// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCheatSheetStore } from '@/lib/onboarding';
import { createAlarmHandler, type AlarmState, type SafetyAlarmHandler } from '@/lib/safety';
import { createFakeChimePlayer } from '@/lib/safety/fakes';
import { AlarmCard } from './AlarmCard';
import { CheatSheet } from './CheatSheet';
import { createSessionRig, FakeKeyingSurface, KEYING_SURFACE } from './onboarding.test-support';
import { SessionApiContext } from './session-api-context';
import { setReducedMotion, topLayer } from './test-setup';

afterEach(cleanup);

const DESCRIPTION = 'Press your input, select Dismiss, or press Escape to stop the alarm.';
const SOUND_NOTE = 'Sound is unavailable on this device right now.';

function renderCard(opts: { readonly startFirst?: boolean } = {}) {
  const chime = createFakeChimePlayer();
  const handler = createAlarmHandler({ chime });
  const states: AlarmState[] = [];
  handler.subscribe(() => states.push(handler.state()));
  if (opts.startFirst === true) handler.start();
  const session = createSessionRig();
  const sheet = createCheatSheetStore(() => ({ onboardingOpen: false, alarmActive: handler.isActive() }));
  const underneath = vi.fn<() => void>();
  const settingsRef = createRef<HTMLDialogElement>();
  const underneathPointerUp = vi.fn<() => void>();
  render(
    <SessionApiContext value={session.value}>
      <FakeKeyingSurface />
      <button type="button" onClick={underneath} onPointerUp={underneathPointerUp}>
        Suggestion underneath
      </button>
      <dialog ref={settingsRef} aria-label="Settings">
        <button type="button">Settings control</button>
      </dialog>
      <CheatSheet store={sheet} />
      <AlarmCard handler={handler} />
    </SessionApiContext>,
  );
  const settings = (): HTMLDialogElement => {
    if (settingsRef.current === null) throw new Error('settings dialog not mounted');
    return settingsRef.current;
  };
  return { chime, handler, states, session, sheet, underneath, underneathPointerUp, settings };
}

const start = (handler: SafetyAlarmHandler): void => act(() => handler.start());
const card = (): HTMLElement => screen.getByRole('alertdialog', { name: 'I need help' });
const dismiss = (): HTMLElement => screen.getByRole('button', { name: 'Dismiss' });

describe('AlarmCard', () => {
  it('is a modal alertdialog named "I need help" whose description names the 3 ways to dismiss', () => {
    const { handler } = renderCard();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    start(handler);
    expect(card().getAttribute('aria-modal')).toBe('true');
    const description = document.getElementById(card().getAttribute('aria-describedby') ?? '');
    expect(description?.textContent).toBe(DESCRIPTION);
    expect(DESCRIPTION).toMatch(/Press your input/);
    expect(DESCRIPTION).toMatch(/select Dismiss/);
    expect(DESCRIPTION).toMatch(/press Escape/);
  });

  it('moves focus to Dismiss inside start(), and Tab and Shift+Tab keep it there', async () => {
    const { handler } = renderCard();
    const user = userEvent.setup();
    screen.getByRole('button', { name: 'Suggestion underneath' }).focus();
    start(handler);
    expect(document.activeElement).toBe(dismiss());
    await user.tab();
    expect(document.activeElement).toBe(dismiss());
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(dismiss());
  });

  it.each([['{Enter}'], [' ']])('%s on Dismiss goes straight to idle with no press in between', async (keys) => {
    const { handler, states, chime } = renderCard();
    const user = userEvent.setup();
    start(handler);
    await user.keyboard(keys);
    expect(handler.state()).toBe('idle');
    expect(states).toEqual(['ringing', 'idle']); // never 'closing', which only a Press_Event causes
    expect(chime.calls).toEqual(['start', 'stop']);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('Escape ends the alarm and leaves an open Settings dialog and Cheat_Sheet as they were', () => {
    const { handler, sheet, settings: settingsDialog } = renderCard();
    const settings = settingsDialog();
    act(() => settings.showModal());
    act(() => sheet.dispatch({ type: 'partner-open' }));
    start(handler);
    fireEvent.keyDown(dismiss(), { key: 'Escape', code: 'Escape' });
    expect(handler.state()).toBe('idle');
    expect(settings.open).toBe(true);
    expect(sheet.getState()).toEqual({ open: true, reason: 'partner', pattern: null });
    expect(screen.getByRole('region', { name: 'All codes' })).toBeDefined();
  });

  it('a pointerdown anywhere on the card hides it, and its pointerup and click reach nothing underneath', () => {
    const { handler, states, underneath, underneathPointerUp, session } = renderCard();
    start(handler);
    fireEvent.pointerDown(card(), { pointerId: 7, button: 0, isPrimary: true });
    expect(handler.state()).toBe('closing');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    const below = screen.getByRole('button', { name: 'Suggestion underneath' });
    fireEvent.pointerUp(below, { pointerId: 7, button: 0, isPrimary: true });
    fireEvent.click(below);
    expect(underneathPointerUp).not.toHaveBeenCalled();
    expect(underneath).not.toHaveBeenCalled();
    expect(states).toEqual(['ringing', 'closing', 'idle']);
    // 2.10: back to idle, focus is on the Keying_Surface.
    expect(session.focusKeyingSurface).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(screen.getByRole('button', KEYING_SURFACE));
    // A later click is not swallowed.
    fireEvent.click(below);
    expect(underneath).toHaveBeenCalledTimes(1);
  });

  it('a pointerdown on Dismiss is the dismissal too, and its click does not dismiss again', () => {
    const { handler, states } = renderCard();
    start(handler);
    const button = dismiss();
    fireEvent.pointerDown(button, { pointerId: 3, button: 0, isPrimary: true });
    fireEvent.pointerUp(button, { pointerId: 3, button: 0, isPrimary: true });
    fireEvent.click(button);
    expect(states).toEqual(['ringing', 'closing', 'idle']);
  });

  it('ignores a secondary-button or non-primary pointerdown', () => {
    const { handler } = renderCard();
    start(handler);
    fireEvent.pointerDown(card(), { pointerId: 2, button: 2, isPrimary: true });
    fireEvent.pointerDown(card(), { pointerId: 4, button: 0, isPrimary: false });
    expect(handler.state()).toBe('ringing');
  });

  it('sits on top of an open Settings dialog and is raised again when another dialog opens while ringing', () => {
    const { handler, settings: settingsDialog } = renderCard();
    const settings = settingsDialog();
    act(() => settings.showModal());
    start(handler);
    expect(topLayer().at(-1)).toBe(card());
    act(() => {
      settings.close();
      settings.showModal();
    });
    expect(topLayer().at(-1)).toBe(card());
    expect(handler.state()).toBe('ringing');
    expect(document.activeElement).toBe(dismiss());
  });

  it('a cancel or a close it did not ask for ends the alarm', () => {
    const { handler } = renderCard();
    start(handler);
    const cancel = new Event('cancel', { cancelable: true });
    act(() => {
      card().dispatchEvent(cancel);
    });
    expect(cancel.defaultPrevented).toBe(true);
    expect(handler.state()).toBe('idle');
    start(handler);
    act(() => (card() as HTMLDialogElement).close());
    expect(handler.state()).toBe('idle');
  });

  it('shows itself when it registers after the alarm started', () => {
    const { handler } = renderCard({ startFirst: true });
    expect(handler.state()).toBe('ringing');
    expect(card()).toBeDefined();
    expect(document.activeElement).toBe(dismiss());
  });

  it('shows the sound note while the chime reports it, and only then', () => {
    const { handler, chime } = renderCard();
    start(handler);
    expect(screen.queryByText(SOUND_NOTE)).toBeNull();
    act(() => chime.setSoundUnavailable(true));
    expect(screen.getByText(SOUND_NOTE)).toBeDefined();
    act(() => chime.setSoundUnavailable(false));
    expect(screen.queryByText(SOUND_NOTE)).toBeNull();
  });

  it('never animates, with or without reduced motion', () => {
    const { handler } = renderCard();
    start(handler);
    for (const reduce of [false, true]) {
      act(() => setReducedMotion(reduce));
      for (const element of [card(), ...card().querySelectorAll('*')]) {
        expect(element.getAttribute('class') ?? '').not.toMatch(/animate|transition/);
      }
    }
  });
});
