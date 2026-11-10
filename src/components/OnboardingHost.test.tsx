// @vitest-environment jsdom
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { memoryBackend } from '@/lib/conversation';
import { createManualClock, createManualScheduler } from '@/lib/input';
import { ONBOARDING_KEY, createOnboardingController, type OnboardingController } from '@/lib/onboarding';
import { createFakeEngineFactory } from '@/lib/onboarding/fakes';
import { nextFrames, renderDitApp } from './dit-app.test-support';
import { createSessionRig } from './onboarding.test-support';
import { OnboardingHost } from './OnboardingHost';
import { RunSetupAgainButton } from './RunSetupAgainButton';
import { SessionApiContext } from './session-api-context';

afterEach(cleanup);

const COMPLETE = JSON.stringify({ v: 1, complete: true, inputChoice: 'key-tap', estimates: null });

function makeController(backend = memoryBackend()): OnboardingController {
  const clock = createManualClock(1000);
  return createOnboardingController({
    backend: () => backend,
    clock: () => clock.now,
    scheduler: () => createManualScheduler(clock.now),
    createEngine: createFakeEngineFactory().create,
    alarm: { start: () => undefined },
    router: { onOnboardingOpenChange: () => undefined },
  });
}

describe('OnboardingHost', () => {
  it('attaches the controller in a layout effect, before any passive effect runs', () => {
    const controller = makeController();
    const order: string[] = [];
    const attach = controller.attach;
    controller.attach = (api) => {
      order.push(`attach (open: ${String(controller.isOpen())})`);
      return attach(api);
    };
    function PassiveProbe() {
      useEffect(() => {
        order.push(`passive (open: ${String(controller.isOpen())})`);
      }, []);
      return null;
    }
    render(
      <SessionApiContext value={createSessionRig().value}>
        <PassiveProbe />
        <OnboardingHost controller={controller} />
      </SessionApiContext>,
    );
    expect(order).toEqual(['attach (open: false)', 'passive (open: true)']);
    expect(screen.getByRole('dialog', { name: 'Choose an input' })).toBeDefined();
  });

  it('"Run setup again" in Settings closes Settings, opens the flow and focuses the selected choice', async () => {
    const backend = memoryBackend({ [ONBOARDING_KEY]: COMPLETE });
    const controller = makeController(backend);
    renderDitApp({
      overlay: <OnboardingHost controller={controller} />,
      extraSettingsActions: ({ closeSettings }) => <RunSetupAgainButton controller={controller} closeSettings={closeSettings} />,
    });
    const user = userEvent.setup();
    expect(screen.queryByRole('dialog')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    const settings = screen.getByRole('dialog', { name: 'Settings' });
    await user.click(within(settings).getByRole('button', { name: 'Run setup again' }));
    expect(screen.queryByRole('dialog', { name: 'Settings' })).toBeNull();
    const flow = screen.getByRole('dialog', { name: 'Choose an input' });
    await act(nextFrames);
    const selected = within(flow).getByRole('button', { name: 'Key or tap' });
    expect(selected.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(selected);
    expect(backend.getItem(ONBOARDING_KEY)).toBe(COMPLETE); // nothing written before Start
  });

  it('Start saves the setup, closes the flow and focuses the Keying_Surface', async () => {
    const backend = memoryBackend();
    const controller = makeController(backend);
    const rig = renderDitApp({ overlay: <OnboardingHost controller={controller} /> });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Key or tap' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Use default speed' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: 'Start' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(nextFrames);
    expect(document.activeElement).toBe(rig.surface());
    expect(JSON.parse(backend.getItem(ONBOARDING_KEY) ?? 'null')).toEqual({
      v: 1,
      complete: true,
      inputChoice: 'key-tap',
      estimates: null,
    });
  });
});
