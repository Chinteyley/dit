// @vitest-environment jsdom
import { act, cleanup, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { err, ok, type SourceStatus } from '@/lib/input';
import { renderOnboarding, type ControllerRig } from './onboarding.test-support';

afterEach(cleanup);

const tile = (name: string): HTMLElement => screen.getByRole('button', { name });
const continueButton = (): HTMLButtonElement => screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
const startBlinkCalls = (rig: ControllerRig): number => rig.sources.calls.filter((call) => call.kind === 'startBlink').length;

describe('InputStep', () => {
  it('shows the three choices with none selected and Continue disabled', () => {
    renderOnboarding();
    expect(screen.getByRole('group', { name: 'How does the speaker press?' })).toBeDefined();
    for (const name of ['Key or tap', 'Switch', 'Blink']) expect(tile(name).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByText('Selected')).toBeNull();
    expect(continueButton().disabled).toBe(true);
  });

  it('"Key or tap" is selected with a visible marker and enables Continue', async () => {
    renderOnboarding();
    await userEvent.setup().click(tile('Key or tap'));
    expect(tile('Key or tap').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('Selected')).toBeDefined();
    expect(continueButton().disabled).toBe(false);
  });

  it('"Switch" arms the learner, then shows the learned key and enables Continue', async () => {
    const rig = renderOnboarding();
    await userEvent.setup().click(tile('Switch'));
    expect(rig.learner.arms).toBe(1);
    expect(screen.getByText('Press the switch now.')).toBeDefined();
    expect(continueButton().disabled).toBe(true);
    await act(async () => {
      rig.learner.resolve(ok('KeyF'));
    });
    expect(screen.getByText('Switch learned. Key: KeyF')).toBeDefined();
    expect(continueButton().disabled).toBe(false);
  });

  it('a failed switch shows the message with "Try again" and "Use key or tap instead"', async () => {
    const rig = renderOnboarding();
    const user = userEvent.setup();
    await user.click(tile('Switch'));
    await act(async () => {
      rig.learner.resolve(err({ reason: 'reserved-input', code: 'Space', message: 'Space and Enter already key Morse.' }));
    });
    expect(screen.getByText('Space and Enter already key Morse.')).toBeDefined();
    expect(continueButton().disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(rig.learner.arms).toBe(2);
    expect(screen.getByText('Press the switch now.')).toBeDefined();
    await act(async () => {
      rig.learner.resolve(err({ reason: 'cancelled', message: 'Switch learning was cancelled.' }));
    });
    await user.click(screen.getByRole('button', { name: 'Use key or tap instead' }));
    expect(tile('Key or tap').getAttribute('aria-pressed')).toBe('true');
    expect(continueButton().disabled).toBe(false);
  });

  it('"Blink" explains the camera and makes no camera request until "Turn on camera"', async () => {
    const rig = renderOnboarding();
    const user = userEvent.setup();
    await user.click(tile('Blink'));
    expect(
      screen.getByText('Dit uses the camera to see when the eyes close. Video stays on this device. It is never sent or saved.'),
    ).toBeDefined();
    expect(startBlinkCalls(rig)).toBe(0);
    await user.click(screen.getByRole('button', { name: 'Turn on camera' }));
    expect(startBlinkCalls(rig)).toBe(1);
    expect(screen.getByText('Starting camera…')).toBeDefined();
    expect(continueButton().disabled).toBe(true);
  });

  it.each([
    ['active', 'Camera on. Blinks now count as presses.', false],
    ['face-lost', "Can't see a face. Move the camera or the light.", false],
    ['starting', 'Starting camera…', true],
  ] as const)('shows the %s camera status in plain words', async (status, text, disabled) => {
    const rig = renderOnboarding();
    const user = userEvent.setup();
    await user.click(tile('Blink'));
    await user.click(screen.getByRole('button', { name: 'Turn on camera' }));
    act(() => rig.sources.setStatus('blink', status === 'starting' ? 'active' : status));
    act(() => rig.sources.setStatus('blink', status));
    expect(screen.getByText(text)).toBeDefined();
    expect(continueButton().disabled).toBe(disabled);
  });

  it.each<[SourceStatus, string, boolean]>([
    ['permission-denied', 'Camera permission was refused. Allow the camera for this site in the browser settings, then try again.', true],
    ['no-camera', 'No camera was found.', true],
    ['error', 'The camera could not start.', true],
    ['unsupported', 'This browser cannot use blink input.', false],
  ])('after %s shows the reason, "Use key or tap instead" and "Try again" unless unsupported', async (status, reason, retry) => {
    const rig = renderOnboarding();
    const user = userEvent.setup();
    await user.click(tile('Blink'));
    await user.click(screen.getByRole('button', { name: 'Turn on camera' }));
    act(() => rig.sources.setStatus('blink', 'active'));
    act(() => rig.sources.setStatus('blink', status));
    expect(screen.getByText(reason)).toBeDefined();
    expect(continueButton().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Try again' }) !== null).toBe(retry);
    if (retry) {
      await user.click(screen.getByRole('button', { name: 'Try again' }));
      expect(startBlinkCalls(rig)).toBe(2);
      expect(screen.getByText('Starting camera…')).toBeDefined();
      // The second start fails the same way.
      act(() => rig.sources.setStatus('blink', 'starting'));
      act(() => rig.sources.setStatus('blink', status));
    }
    await user.click(screen.getByRole('button', { name: 'Use key or tap instead' }));
    expect(tile('Key or tap').getAttribute('aria-pressed')).toBe('true');
    expect(continueButton().disabled).toBe(false);
  });

  it('a disabled Continue keeps the flow on the Input_Step', async () => {
    renderOnboarding();
    await userEvent.setup().click(continueButton());
    expect(screen.getByRole('heading', { level: 2, name: 'Choose an input' })).toBeDefined();
  });
});
