// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, memoryBackend } from '@/lib/conversation';
import { throwingBackend } from '@/lib/conversation/test-support';
import { createManualClock, createManualScheduler, type SourceStatus } from '@/lib/input';
import { ONBOARDING_KEY, createOnboardingController, type OnboardingController } from '@/lib/onboarding';
import { createFakeEngineFactory, createFakeSourceControl, type FakeSourceControl } from '@/lib/onboarding/fakes';
import { SafetyNotices } from './SafetyNotices';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const BUTTON = { name: 'Turn on camera for blink input' } as const;
const SAVE_FAILED = 'Setup could not be saved on this device. It will show again next time.';

function setup(backend = memoryBackend({ [ONBOARDING_KEY]: JSON.stringify({ v: 1, complete: true, inputChoice: 'blink', estimates: null }) })): {
  controller: OnboardingController;
  sources: FakeSourceControl;
} {
  const clock = createManualClock(1000);
  const controller = createOnboardingController({
    backend: () => backend,
    clock: () => clock.now,
    scheduler: () => createManualScheduler(clock.now),
    createEngine: createFakeEngineFactory().create,
    alarm: { start: () => undefined },
    router: { onOnboardingOpenChange: () => undefined },
  });
  const sources = createFakeSourceControl();
  controller.attach({
    setInitialEstimates: () => undefined,
    focusKeyingSurface: () => undefined,
    focusSelectedChoice: () => undefined,
    settings: () => DEFAULT_SETTINGS,
    sources,
    learner: null,
    pendingSince: () => null,
  });
  render(<SafetyNotices onboarding={controller} />);
  return { controller, sources };
}

const startBlinkCalls = (sources: FakeSourceControl): number => sources.calls.filter((call) => call.kind === 'startBlink').length;

describe('SafetyNotices', () => {
  it('offers the blink camera after a load with Blink saved, and starts it once inside the click', async () => {
    const { sources } = setup();
    let duringClick = -1;
    const button = screen.getByRole('button', BUTTON);
    // React handles the click at its root, so a window listener runs right after its handler.
    const probe = (): void => {
      duringClick = startBlinkCalls(sources);
    };
    window.addEventListener('click', probe);
    await userEvent.setup().click(button);
    window.removeEventListener('click', probe);
    expect(duringClick).toBe(1);
    expect(startBlinkCalls(sources)).toBe(1);
  });

  it.each<SourceStatus>(['starting', 'active', 'face-lost'])('hides the button while the camera is %s', (status) => {
    const { sources } = setup();
    act(() => sources.setStatus('blink', status));
    expect(screen.queryByRole('button', BUTTON)).toBeNull();
  });

  it.each([
    ['permission-denied', 'Camera permission was refused. Allow the camera for this site in the browser settings, then try again.', true],
    ['no-camera', 'No camera was found.', true],
    ['error', 'The camera could not start.', true],
    ['unsupported', 'This browser cannot use blink input.', false],
  ] as const)('after %s shows the reason, and the button again unless the browser cannot do blink', (status, reason, retry) => {
    const { sources } = setup();
    act(() => sources.setStatus('blink', 'active'));
    act(() => sources.setStatus('blink', status));
    expect(screen.getByText(reason)).toBeDefined();
    expect(screen.queryByRole('button', BUTTON) !== null).toBe(retry);
  });

  it('shows nothing for a saved Key or tap choice', () => {
    cleanup();
    setup(memoryBackend({ [ONBOARDING_KEY]: JSON.stringify({ v: 1, complete: true, inputChoice: 'key-tap', estimates: null }) }));
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
  });

  it('keeps the save-failure note for at least 10 seconds after setup closes', () => {
    vi.useFakeTimers();
    // Writes throw (a full or blocked localStorage): the flow opens, and Start cannot save.
    const { controller } = setup(throwingBackend({ set: true }));
    act(() => {
      controller.dispatch({ type: 'choose', choice: 'key-tap' });
      controller.dispatch({ type: 'continue' });
      controller.dispatch({ type: 'use-default' });
      controller.dispatch({ type: 'continue' });
      controller.dispatch({ type: 'start' });
    });
    expect(controller.isOpen()).toBe(false);
    expect(screen.getByText(SAVE_FAILED)).toBeDefined();
    act(() => vi.advanceTimersByTime(10_000));
    expect(screen.getByText(SAVE_FAILED)).toBeDefined();
  });
});
