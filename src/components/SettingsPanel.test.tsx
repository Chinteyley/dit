// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { useState, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_SETTINGS,
  RATE_RANGE_MESSAGE,
  validateSettingsPatch,
  type SettingsPatch,
  type SettingsRecord,
} from '@/lib/conversation';
import { err } from '@/lib/input';
import { initialListen, type ListenState } from '@/lib/speech';
import { FAKE_VOICES } from '@/lib/speech/fakes';
import { INERT_SESSION_API, SessionApiContext } from './session-api-context';
import { SettingsPanel } from './SettingsPanel';

afterEach(cleanup);

interface HarnessOptions {
  readonly settings?: Partial<SettingsRecord>;
  readonly listen?: ListenState;
  readonly extraActions?: ReactNode;
  /** Reject every speech-rate change, as the controller does for an invalid one. */
  readonly rejectRate?: boolean;
}

function renderPanel(opts: HarnessOptions = {}) {
  const onPatch = vi.fn<(patch: SettingsPatch) => void>();
  const onListen = vi.fn<(on: boolean) => void>();
  const onClearHistory = vi.fn();
  const onClose = vi.fn();
  const focusKeyingSurface = vi.fn();

  function Harness() {
    const [open, setOpen] = useState(false);
    const [settings, setSettings] = useState<SettingsRecord>({ ...DEFAULT_SETTINGS, ...opts.settings });
    return (
      <SessionApiContext value={{ ...INERT_SESSION_API, focusKeyingSurface }}>
        <button type="button" onClick={() => setOpen(true)}>
          Settings
        </button>
        <SettingsPanel
          open={open}
          settings={settings}
          voices={FAKE_VOICES}
          listen={opts.listen ?? initialListen(true)}
          onClose={() => {
            onClose();
            setOpen(false);
          }}
          onPatch={(patch) => {
            onPatch(patch);
            if (opts.rejectRate === true && patch.speechRate !== undefined) {
              return err([{ field: 'speechRate', value: patch.speechRate, message: RATE_RANGE_MESSAGE }]);
            }
            const result = validateSettingsPatch(settings, patch);
            if (result.ok) setSettings(result.value);
            return result;
          }}
          onListen={onListen}
          onClearHistory={onClearHistory}
          extraActions={opts.extraActions}
        />
      </SessionApiContext>
    );
  }

  render(<Harness />);
  const user = userEvent.setup();
  const open = async (): Promise<HTMLElement> => {
    await user.click(screen.getByRole('button', { name: 'Settings' }));
    return screen.getByRole('dialog', { name: 'Settings' });
  };
  return { user, open, onPatch, onListen, onClearHistory, onClose, focusKeyingSurface };
}

const control = (dialog: HTMLElement) => ({
  voice: within(dialog).getByRole('combobox', { name: 'Voice' }) as HTMLSelectElement,
  rate: within(dialog).getByRole('slider', { name: 'Speech rate' }) as HTMLInputElement,
  listen: within(dialog).getByRole('switch', { name: 'Listen' }),
  flip: within(dialog).getByRole('switch', { name: 'Flip partner display' }),
  clear: within(dialog).getByRole('button', { name: 'Clear history' }),
  wpm: within(dialog).getByRole('spinbutton', { name: 'Starting speed (WPM)' }) as HTMLInputElement,
  adapt: within(dialog).getByRole('switch', { name: 'Adapt to my speed' }),
  close: within(dialog).getByRole('button', { name: 'Close settings' }),
});

describe('SettingsPanel', () => {
  it('opens as a modal dialog named "Settings" (Req 20.1)', async () => {
    const { open } = renderPanel();
    expect(screen.queryByRole('dialog')).toBeNull();
    const dialog = await open();
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect((dialog as HTMLDialogElement).open).toBe(true);
  });

  it('shows every control with its label and current value (Req 20.3, 20.4)', async () => {
    const { open } = renderPanel({
      settings: { voiceURI: 'fake-voice-b', speechRate: 1.3, flip: true, startingWpm: 9, adaptive: false },
    });
    const c = control(await open());
    expect(c.voice.value).toBe('fake-voice-b');
    expect(c.rate.value).toBe('1.3');
    expect(c.rate.min).toBe('0.5');
    expect(c.rate.max).toBe('2');
    expect(c.listen.getAttribute('aria-checked')).toBe('false');
    expect(c.flip.getAttribute('aria-checked')).toBe('true');
    expect(c.wpm.value).toBe('9');
    expect(c.wpm.min).toBe('2');
    expect(c.wpm.max).toBe('20');
    expect(c.adapt.getAttribute('aria-checked')).toBe('false');
    expect(c.clear).toBeDefined();
    expect(c.close).toBeDefined();
  });

  it('starts with focus on the first control and wraps Tab both ways (Req 20.4, 20.7)', async () => {
    const { open, user } = renderPanel();
    const c = control(await open());
    expect(document.activeElement).toBe(c.voice);
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(c.close);
    await user.tab();
    expect(document.activeElement).toBe(c.voice);
    const order = [c.rate, c.listen, c.flip, c.wpm, c.adapt, c.clear, c.close, c.voice];
    for (const next of order) {
      await user.tab();
      expect(document.activeElement).toBe(next);
    }
  });

  it('closes on Escape and returns focus to the Keying_Surface (Req 20.2, 20.8, 21.4)', async () => {
    const { open, user, onClose, focusKeyingSurface } = renderPanel();
    const dialog = (await open()) as HTMLDialogElement;
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(dialog.open).toBe(false);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(focusKeyingSurface).toHaveBeenCalledTimes(1);
  });

  it('closes with "Close settings" and returns focus to the Keying_Surface', async () => {
    const { open, user, onClose, focusKeyingSurface } = renderPanel();
    await user.click(control(await open()).close);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(focusKeyingSurface).toHaveBeenCalledTimes(1);
  });

  it('closes on a press on the backdrop, but not on a press inside', async () => {
    const { open, user, onClose, focusKeyingSurface } = renderPanel();
    const dialog = await open();
    await user.click(within(dialog).getByRole('heading', { name: 'Settings' }));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(dialog);
    fireEvent.click(dialog);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(focusKeyingSurface).toHaveBeenCalledTimes(1);
  });

  it('keeps the previous Starting_WPM and shows the range when the entry is invalid (Req 20.6)', async () => {
    const { open, user, onPatch } = renderPanel();
    const c = control(await open());
    await user.clear(c.wpm);
    await user.type(c.wpm, '25{Enter}');
    expect(onPatch).toHaveBeenLastCalledWith({ startingWpm: 25 });
    const field = control(screen.getByRole('dialog', { name: 'Settings' })).wpm;
    expect(field.value).toBe('6');
    const message = screen.getByText('Enter a number from 2 to 20.');
    expect(field.getAttribute('aria-describedby')).toBe(message.id);
    await user.clear(field);
    await user.keyboard('{Enter}');
    expect(field.value).toBe('6');
    await user.clear(field);
    await user.type(field, '8{Enter}');
    expect(field.value).toBe('8');
    expect(screen.queryByText('Enter a number from 2 to 20.')).toBeNull();
  });

  it('keeps the previous speech rate when a change is rejected (Req 17.9)', async () => {
    const rejected = renderPanel({ rejectRate: true });
    const slider = control(await rejected.open()).rate;
    fireEvent.change(slider, { target: { value: '1.5' } });
    expect(rejected.onPatch).toHaveBeenLastCalledWith({ speechRate: 1.5 });
    expect(slider.value).toBe('1');
    cleanup();
    const accepted = renderPanel();
    const next = control(await accepted.open()).rate;
    fireEvent.change(next, { target: { value: '1.5' } });
    expect(next.value).toBe('1.5');
  });

  it('switches flip and adaptation and passes Listen through (Req 14.7, 20.5)', async () => {
    const { open, user, onPatch, onListen } = renderPanel();
    const c = control(await open());
    await user.click(c.flip);
    expect(onPatch).toHaveBeenLastCalledWith({ flip: true });
    expect(c.flip.getAttribute('aria-checked')).toBe('true');
    await user.click(c.adapt);
    expect(onPatch).toHaveBeenLastCalledWith({ adaptive: false });
    await user.click(c.listen);
    expect(onListen).toHaveBeenCalledWith(true);
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeDefined();
  });

  it('confirms before clearing history, and closes either way (Req 15.4 to 15.6, 21.5)', async () => {
    const confirm = renderPanel();
    await confirm.user.click(control(await confirm.open()).clear);
    const prompt = screen.getByRole('alertdialog', { name: 'Clear the whole conversation?' });
    expect(confirm.onClearHistory).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(within(prompt).getByRole('button', { name: 'Cancel' }));
    await confirm.user.click(within(prompt).getByRole('button', { name: 'Clear history' }));
    expect(confirm.onClearHistory).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(confirm.focusKeyingSurface).toHaveBeenCalledTimes(1);
    cleanup();

    const cancel = renderPanel();
    await cancel.user.click(control(await cancel.open()).clear);
    await cancel.user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(cancel.onClearHistory).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(cancel.focusKeyingSurface).toHaveBeenCalledTimes(1);
  });

  it('shows "Browser default" when the stored voice is missing, and maps it back to null (Req 17.2, 17.7)', async () => {
    const { open, user, onPatch } = renderPanel({ settings: { voiceURI: 'a-voice-that-is-gone' } });
    const c = control(await open());
    expect(c.voice.value).toBe('');
    expect(c.voice.selectedOptions[0]?.textContent).toBe('Browser default');
    await user.selectOptions(c.voice, 'fake-voice-b');
    expect(onPatch).toHaveBeenLastCalledWith({ voiceURI: 'fake-voice-b' });
    await user.selectOptions(c.voice, '');
    expect(onPatch).toHaveBeenLastCalledWith({ voiceURI: null });
  });

  it('starts fresh each time it opens', async () => {
    const { open, user } = renderPanel();
    await user.click(control(await open()).clear);
    await user.keyboard('{Escape}');
    expect(control(await open()).clear).toBeDefined();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  describe('extraActions', () => {
    const runSetupAgain = <button type="button">Run setup again</button>;

    it('renders the extra action inside the dialog, right after "Clear history" (Req 20.3)', async () => {
      const { open } = renderPanel({ extraActions: runSetupAgain });
      const dialog = await open();
      const names = within(dialog)
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent);
      expect(names.indexOf('Run setup again')).toBe(names.indexOf('Clear history') + 1);
    });

    it('includes the extra action in the Tab wrap (Req 20.7)', async () => {
      const { open, user } = renderPanel({ extraActions: runSetupAgain });
      const dialog = await open();
      const c = control(dialog);
      const extra = within(dialog).getByRole('button', { name: 'Run setup again' });
      const seen: Element[] = [];
      for (let i = 0; i < 10; i++) {
        await user.tab();
        seen.push(document.activeElement as Element);
      }
      expect(seen.indexOf(extra)).toBe(seen.indexOf(c.clear) + 1);
      expect(seen.indexOf(c.close)).toBe(seen.indexOf(extra) + 1);
      expect(seen[seen.indexOf(c.close) + 1]).toBe(c.voice);
      c.voice.focus();
      await user.tab({ shift: true });
      expect(document.activeElement).toBe(c.close);
    });

    it('renders the same buttons as before without the prop', async () => {
      const { open } = renderPanel();
      const names = within(await open())
        .getAllByRole('button')
        .map((button) => button.getAttribute('aria-label') ?? button.textContent);
      expect(names).toStrictEqual(['Clear history', 'Close settings']);
    });
  });
});
