// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PressEvent } from '@/lib/input';
import { initialFirstRun, onboardingStep, type OnboardingAction, type OnboardingState } from '@/lib/onboarding';
import { OnboardingFlow } from './OnboardingFlow';
import { renderOnboarding, type ControllerRig } from './onboarding.test-support';

afterEach(cleanup);

const COMPLETE = { v: 1, complete: true, inputChoice: 'key-tap', estimates: null } as const;

function reduce(actions: readonly OnboardingAction[]): OnboardingState {
  return actions.reduce<OnboardingState>((state, action) => onboardingStep(state, action), initialFirstRun());
}

const TO_PRACTICE: readonly OnboardingAction[] = [{ type: 'choose', choice: 'key-tap' }, { type: 'continue' }];
const TO_LEGEND: readonly OnboardingAction[] = [...TO_PRACTICE, { type: 'use-default' }, { type: 'continue' }];
const TO_DONE: readonly OnboardingAction[] = [...TO_LEGEND, { type: 'start' }];

const press = (rig: ControllerRig, kind: PressEvent['kind'], t: number): void =>
  act(() => rig.controller.handlePress({ kind, t, source: 'keyboard' }));

/** The flow's own polite live region (the page's other one belongs to the conversation). */
function liveText(): string | null {
  const dialog = screen.getByRole('dialog');
  return dialog.querySelector('[aria-live="polite"]')?.textContent ?? null;
}

describe('OnboardingFlow', () => {
  it.each([
    ['input', [], 'Choose an input', true],
    ['practice', TO_PRACTICE, 'Practice', false],
    ['legend', TO_LEGEND, 'Commands', false],
    ['done', TO_DONE, 'Setup done', true],
  ] as const)('gives the %s step one h2, opens modal only for Partner steps, and adds no h1', (_step, actions, heading, modal) => {
    render(
      <>
        <h1>Dit</h1>
        <OnboardingFlow state={reduce(actions)} dispatch={vi.fn()} startingWpm={6} />
      </>,
    );
    const dialog = screen.getByRole('dialog', { name: heading });
    expect(within(dialog).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([heading]);
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(dialog.matches(':modal')).toBe(modal);
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  it('announces each new step heading and each new practice count, and nothing per press', async () => {
    const rig = renderOnboarding();
    const user = userEvent.setup();
    expect(liveText()).toBe('Choose an input');
    await user.click(screen.getByRole('button', { name: 'Key or tap' }));
    expect(liveText()).toBe('Choose an input');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(liveText()).toBe('Practice');
    press(rig, 'down', 2000);
    expect(liveText()).toBe('Practice');
    press(rig, 'up', 2120);
    expect(liveText()).toBe('1 of 5');
    press(rig, 'down', 3000);
    expect(liveText()).toBe('1 of 5');
    press(rig, 'up', 3120);
    expect(liveText()).toBe('2 of 5');
    expect(screen.getByRole('dialog').querySelectorAll('[aria-live]')).toHaveLength(1);
  });

  it('never closes a first-run flow on Escape and shows no "Cancel setup"', () => {
    renderOnboarding();
    expect(screen.queryByRole('button', { name: 'Cancel setup' })).toBeNull();
    fireEvent.keyDown(screen.getByRole('button', { name: 'Key or tap' }), { key: 'Escape' });
    expect(screen.getByRole('dialog', { name: 'Choose an input' })).toBeDefined();
  });

  it('shows "Cancel setup" at every step of a rerun; it restores the sources and focuses the Keying_Surface', async () => {
    const rig = renderOnboarding({ record: COMPLETE });
    const user = userEvent.setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => rig.controller.runSetupAgain());
    expect(screen.getByRole('button', { name: 'Cancel setup' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Practice' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel setup' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Use default speed' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Commands' })).toBeDefined();
    await user.click(screen.getByRole('button', { name: 'Cancel setup' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rig.sources.calls.some((call) => call.kind === 'restore')).toBe(true);
    expect(rig.session.focusKeyingSurface).toHaveBeenCalled();
    expect(rig.session.setInitialEstimates.mock.calls).toEqual([[null], [null]]); // load, then "Continue"
  });

  it('Escape cancels a rerun', () => {
    const rig = renderOnboarding({ record: COMPLETE });
    act(() => rig.controller.runSetupAgain());
    fireEvent.keyDown(screen.getByRole('button', { name: 'Key or tap' }), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rig.controller.isOpen()).toBe(false);
  });

  it('keeps the step, the choice and the practice presses through a resize and an orientation change', async () => {
    const rig = renderOnboarding();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Key or tap' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    press(rig, 'down', 2000);
    press(rig, 'up', 2100);
    press(rig, 'down', 3000);
    press(rig, 'up', 3100);
    const { innerWidth, innerHeight } = window;
    act(() => {
      Object.assign(window, { innerWidth: innerHeight, innerHeight: innerWidth });
      fireEvent(window, new Event('resize'));
      fireEvent(window, new Event('orientationchange'));
    });
    Object.assign(window, { innerWidth, innerHeight });
    expect(screen.getByRole('heading', { level: 2, name: 'Practice' })).toBeDefined();
    expect(screen.getByText('Press 3 of 5')).toBeDefined();
    expect(screen.getAllByRole('img', { hidden: true })).toHaveLength(2);
    expect(rig.controller.getView().state?.inputChoice).toBe('key-tap');
  });

  it('places the Practice_Step beside the Keying_Surface as a non-modal panel', async () => {
    renderOnboarding();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Key or tap' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    const dialog = screen.getByRole('dialog', { name: 'Practice' });
    expect(dialog.matches(':modal')).toBe(false);
    expect(dialog.style.top).toBe('0px');
    expect(dialog.style.left).toBe('8px');
  });

  it('returns focus to the keying surface when a partner accepts calibration into the non-modal legend', async () => {
    renderOnboarding();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Key or tap' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Use default speed' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('dialog', { name: 'Commands' }).matches(':modal')).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keying surface' }));
  });
});

it.each(['practice', 'legend'] as const)('Escape from the keying surface cancels a non-modal rerun on %s', (step) => {
  const rig = renderOnboarding({ record: COMPLETE });
  act(() => {
    rig.controller.runSetupAgain();
    rig.controller.dispatch({ type: 'continue' });
    if (step === 'legend') {
      rig.controller.dispatch({ type: 'use-default' });
      rig.controller.dispatch({ type: 'continue' });
    }
  });
  const surface = screen.getByRole('button', { name: 'Keying surface' });
  surface.focus();
  fireEvent.keyDown(surface, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(surface);
});

it('returns focus to the keying surface after choosing default speed', async () => {
  renderOnboarding();
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Key or tap' }));
  await user.click(screen.getByRole('button', { name: 'Continue' }));
  await user.click(screen.getByRole('button', { name: 'Use default speed' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keying surface' }));
  expect(screen.queryByText('Press 1 of 5')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Use default speed' }));
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keying surface' }));
});
