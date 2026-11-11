// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { calibrate } from '@/lib/morse';
import {
  initialFirstRun,
  onboardingStep,
  speedText,
  type OnboardingAction,
  type OnboardingState,
} from '@/lib/onboarding';
import { PracticeStep } from './PracticeStep';

afterEach(cleanup);

/** The Practice_Step after Key or tap, then the given actions. */
function practiceWith(actions: readonly OnboardingAction[] = []): OnboardingState {
  const start = [{ type: 'choose', choice: 'key-tap' }, { type: 'continue' }] as const;
  return [...start, ...actions].reduce<OnboardingState>((state, action) => onboardingStep(state, action), initialFirstRun());
}

/** Presses of the given lengths, each a down then an up, 1 s apart. */
function presses(durations: readonly number[]): OnboardingAction[] {
  return durations.flatMap((duration, index) => {
    const t = 10_000 + index * 5000;
    return [
      { type: 'press', kind: 'down', t },
      { type: 'press', kind: 'up', t: t + duration },
    ] as const;
  });
}

function renderStep(state: OnboardingState) {
  const dispatch = vi.fn<(action: OnboardingAction) => void>();
  render(<PracticeStep state={state} dispatch={dispatch} startingWpm={6} />);
  return dispatch;
}

const glyphNames = (): (string | null)[] =>
  screen.queryAllByRole('img', { hidden: true }).map((glyph) => glyph.getAttribute('aria-label'));

describe('PracticeStep', () => {
  it.each([
    [0, 'Press short', 'Press 1 of 5'],
    [3, 'Press long', 'Press 4 of 5'],
    [4, 'Press long', 'Press 5 of 5'],
  ])('after %i presses asks "%s" with "%s"', (count, prompt, countText) => {
    renderStep(practiceWith(presses([120, 130, 110, 400, 420].slice(0, count))));
    expect(screen.getByText(prompt)).toBeDefined();
    expect(screen.getByText(countText)).toBeDefined();
    expect(glyphNames()).toHaveLength(count);
  });

  it('draws 3 dots then 2 dashes by position, whatever the press lengths', () => {
    renderStep(practiceWith(presses([900, 15, 700, 20, 35])));
    expect(glyphNames()).toEqual(['dot', 'dot', 'dot', 'dash', 'dash']);
    expect(screen.queryAllByRole('img')).toHaveLength(0);
  });

  it('shows "Holding…" while a press is down', () => {
    const held = practiceWith([...presses([120]), { type: 'press', kind: 'down', t: 50_000 }]);
    const { rerender } = render(<PracticeStep state={held} dispatch={vi.fn()} startingWpm={6} />);
    expect(screen.getByText('Holding…')).toBeDefined();
    rerender(<PracticeStep state={onboardingStep(held, { type: 'press', kind: 'up', t: 50_120 })} dispatch={vi.fn()} startingWpm={6} />);
    expect(screen.queryByText('Holding…')).toBeNull();
  });

  it.each([0, 3, 5])('offers "Use default speed" after %i presses', async (count) => {
    const dispatch = renderStep(practiceWith(presses([120, 130, 110, 400, 420].slice(0, count))));
    await userEvent.setup().click(screen.getByRole('button', { name: 'Use default speed' }));
    expect(dispatch.mock.calls).toEqual([[{ type: 'use-default' }]]);
  });

  it('shows the measured speed with "Use this speed" and "Practice again"', async () => {
    const durations = [120, 130, 110, 400, 420];
    const dispatch = renderStep(practiceWith(presses(durations)));
    expect(screen.getByText(speedText(calibrate(durations).dotEstimate))).toBeDefined();
    expect(screen.queryByText(/long presses were close/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue' })).toBeNull();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Use this speed' }));
    await user.click(screen.getByRole('button', { name: 'Practice again' }));
    expect(dispatch.mock.calls).toEqual([[{ type: 'use-this-speed' }], [{ type: 'practice-again' }]]);
  });

  it('adds the close-presses sentence when the long presses were close to the short ones', () => {
    renderStep(practiceWith(presses([100, 100, 100, 120, 130])));
    expect(
      screen.getByText('The long presses were close to the short ones, so Dit set long to 3 times short.'),
    ).toBeDefined();
  });

  it('after "Use default speed" shows the Starting_WPM speed and Continue, and no "Practice again"', async () => {
    const dispatch = renderStep(practiceWith([{ type: 'use-default' }]));
    expect(screen.getByText('Default speed: about 6 words per minute')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Practice again' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Use this speed' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Continue' }));
    expect(dispatch.mock.calls).toEqual([[{ type: 'continue' }]]);
  });

  it('after a fallback calibration shows the default speed with "Practice again" and Continue', () => {
    const durations = [0, 0, 0, 0, 0];
    expect(calibrate(durations).reason).not.toBeNull();
    renderStep(practiceWith(presses(durations)));
    expect(screen.getByText('Default speed: about 6 words per minute')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Practice again' })).toBeDefined();
    expect((screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByRole('button', { name: 'Use this speed' })).toBeNull();
    expect(screen.queryByText(/long presses were close/)).toBeNull();
  });

  it('uses no animation or transition', () => {
    const { container } = render(<PracticeStep state={practiceWith(presses([100, 110]))} dispatch={vi.fn()} startingWpm={6} />);
    for (const element of container.querySelectorAll('*')) {
      expect(element.getAttribute('class') ?? '').not.toMatch(/animate|transition/);
    }
  });
});
