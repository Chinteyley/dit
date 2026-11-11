// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LISTEN_MESSAGE_TEXT, initialListen, type ListenState } from '@/lib/speech';
import { INERT_SESSION_API, SessionApiContext } from './session-api-context';
import { ListenToggle } from './ListenToggle';
import { createControllerRig, char, SPEAK } from '@/hooks/session-controller.test-support';
import { createFakeSpeechInput } from '@/lib/speech/fakes';

afterEach(cleanup);

function renderToggle(listen: ListenState, returnFocus?: boolean) {
  const onToggle = vi.fn();
  const focusKeyingSurface = vi.fn();
  render(
    <SessionApiContext value={{ ...INERT_SESSION_API, focusKeyingSurface }}>
      {returnFocus === undefined ? (
        <ListenToggle listen={listen} onToggle={onToggle} />
      ) : (
        <ListenToggle listen={listen} onToggle={onToggle} returnFocus={returnFocus} />
      )}
    </SessionApiContext>,
  );
  const toggle = screen.getByRole('switch', { name: 'Listen' }) as HTMLButtonElement;
  return { onToggle, focusKeyingSurface, toggle, user: userEvent.setup() };
}

const OFF = initialListen(true);
const ON: ListenState = { ...OFF, on: true };

describe('ListenToggle', () => {
  it('announces server transcription while keeping Listen checked', () => {
    const { toggle } = renderToggle({ ...ON, message: 'server-transcription' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('status').textContent).toBe('Listening (server transcription)');
  });

  it('pauses input through consecutive Dit utterances and resumes only after the latest ends', () => {
    const input = createFakeSpeechInput();
    const pause = vi.fn();
    input.setPaused = pause;
    const rig = createControllerRig({ speechInput: input });
    rig.controller.setListen(true);
    pause.mockClear();
    for (const letter of ['a', 'b']) {
      rig.down(); rig.script(char(letter)); rig.up();
      rig.down(); rig.script(SPEAK); rig.up();
    }
    expect(pause.mock.calls).toEqual([[true], [true]]);
    rig.speechOutput.finish('done');
    expect(pause.mock.calls).toEqual([[true], [true], [false]]);
    rig.controller.dispose();
  });

  it('is a switch named "Listen" that reflects on and off (Req 18.1)', () => {
    const off = renderToggle(OFF);
    expect(off.toggle.getAttribute('aria-checked')).toBe('false');
    cleanup();
    const on = renderToggle(ON);
    expect(on.toggle.getAttribute('aria-checked')).toBe('true');
  });

  it('is disabled and off with the unsupported text when the browser cannot listen (Req 18.2)', () => {
    const { toggle } = renderToggle(initialListen(false));
    expect(toggle.disabled).toBe(true);
    expect(toggle.getAttribute('aria-checked')).toBe('false');
    expect(screen.getByText('Listening is not supported in this browser. Type your line instead.')).toBeDefined();
  });

  it('asks for the opposite state and returns focus to the Keying_Surface (Req 18.3, 21.1)', async () => {
    const { onToggle, focusKeyingSurface, toggle, user } = renderToggle(OFF);
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(focusKeyingSurface).toHaveBeenCalledTimes(1);
    cleanup();
    const second = renderToggle(ON);
    await second.user.click(second.toggle);
    expect(second.onToggle).toHaveBeenCalledWith(false);
  });

  it('keeps focus where it is inside the Settings_Panel', async () => {
    const { onToggle, focusKeyingSurface, toggle, user } = renderToggle(OFF, false);
    await user.click(toggle);
    expect(onToggle).toHaveBeenCalledWith(true);
    expect(focusKeyingSurface).not.toHaveBeenCalled();
  });

  it('shows the interim transcript and the permission message (Req 18.6, 18.8)', () => {
    renderToggle({ ...ON, interim: 'are you warm enough' });
    expect(screen.getByText('are you warm enough')).toBeDefined();
    cleanup();
    const { toggle } = renderToggle({ ...OFF, message: 'permission-denied' });
    const message = screen.getByText(LISTEN_MESSAGE_TEXT['permission-denied']);
    expect(toggle.getAttribute('aria-describedby')).toBe(message.id);
  });
});
