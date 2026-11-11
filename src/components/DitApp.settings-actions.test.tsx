// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SettingsActionsApi } from './DitApp';
import { nextFrames, renderDitApp } from './dit-app.test-support';

afterEach(cleanup);

/** The render prop onboarding-and-safety will pass: a "Run setup again" button that closes Settings. */
function runSetupAgain(options?: { readonly focusKeyingSurface?: boolean }, onRun: () => void = () => undefined) {
  return function renderRunSetupAgain({ closeSettings }: SettingsActionsApi) {
    return (
      <button
        type="button"
        onClick={() => {
          closeSettings(options);
          onRun();
        }}
      >
        Run setup again
      </button>
    );
  };
}

describe('DitApp extraSettingsActions (onboarding O11.6, O11.7)', () => {
  it('renders the action inside the Settings dialog', async () => {
    const rig = renderDitApp({ extraSettingsActions: runSetupAgain({ focusKeyingSurface: false }) });
    expect(screen.queryByRole('button', { name: 'Run setup again' })).toBeNull();
    await rig.user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).getByRole('button', { name: 'Run setup again' })).toBeDefined();
  });

  it('closeSettings({ focusKeyingSurface: false }) closes without moving focus to the Keying_Surface (Req 20.8)', async () => {
    const onRun = vi.fn();
    const rig = renderDitApp({ extraSettingsActions: runSetupAgain({ focusKeyingSurface: false }, onRun) });
    await rig.user.click(screen.getByRole('button', { name: 'Settings' }));
    await rig.user.click(screen.getByRole('button', { name: 'Run setup again' }));
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    await nextFrames();
    expect(document.activeElement).not.toBe(rig.surface());
  });

  it('closeSettings() closes and focuses the Keying_Surface, like the panel’s own close paths (Req 21.4)', async () => {
    const rig = renderDitApp({ extraSettingsActions: runSetupAgain() });
    await rig.user.click(screen.getByRole('button', { name: 'Settings' }));
    await rig.user.click(screen.getByRole('button', { name: 'Run setup again' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(rig.surface()));
  });

  it('renders nothing extra without the prop', async () => {
    const rig = renderDitApp();
    await rig.user.click(screen.getByRole('button', { name: 'Settings' }));
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(within(dialog).queryByRole('button', { name: 'Run setup again' })).toBeNull();
    expect(
      within(dialog)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent),
    ).toStrictEqual(['Clear history', 'Close settings']);
  });
});
