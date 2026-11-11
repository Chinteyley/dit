import { describe, expect, it } from 'vitest';
import { LISTEN_MESSAGE_TEXT, initialListen, listenStep, type ListenState } from './listen';

const on = (overrides: Partial<ListenState> = {}): ListenState => ({
  supported: true,
  on: true,
  interim: '',
  message: null,
  ...overrides,
});

describe('initialListen', () => {
  it('starts off, with the unsupported message only when recognition is missing', () => {
    expect(initialListen(true)).toEqual({ supported: true, on: false, interim: '', message: null });
    expect(initialListen(false)).toEqual({ supported: false, on: false, interim: '', message: 'unsupported' });
    expect(LISTEN_MESSAGE_TEXT.unsupported).toBe('Listening is not supported in this browser. Type your line instead.');
  });
});

describe('listenStep', () => {
  it('toggle on starts recognition and clears an earlier message', () => {
    const off = { ...initialListen(true), message: 'stopped' as const };
    expect(listenStep(off, { type: 'toggle', on: true })).toEqual({ state: on(), command: 'start' });
  });

  it('toggle on is ignored when recognition is unsupported, and when already on', () => {
    const unsupported = initialListen(false);
    expect(listenStep(unsupported, { type: 'toggle', on: true })).toEqual({ state: unsupported, command: null });
    expect(listenStep(on(), { type: 'toggle', on: true })).toEqual({ state: on(), command: null });
  });

  it('toggle off stops recognition and clears the interim transcript', () => {
    expect(listenStep(on({ interim: 'are you' }), { type: 'toggle', on: false })).toEqual({
      state: on({ on: false }),
      command: 'stop',
    });
  });

  it('an interim transcript replaces the previous one while on, and is ignored while off', () => {
    expect(listenStep(on({ interim: 'are' }), { type: 'interim', text: 'are you' }).state.interim).toBe('are you');
    const off = initialListen(true);
    expect(listenStep(off, { type: 'interim', text: 'stray' })).toEqual({ state: off, command: null });
  });

  it('a final transcript clears the interim transcript', () => {
    expect(listenStep(on({ interim: 'are you thirsty' }), { type: 'final' })).toEqual({ state: on(), command: null });
  });

  it('permission and microphone errors switch Listen off with their own message, without restart', () => {
    expect(listenStep(on({ interim: 'x' }), { type: 'error', error: 'permission-denied' })).toEqual({
      state: on({ on: false, message: 'permission-denied' }),
      command: 'stop',
    });
    expect(listenStep(on(), { type: 'error', error: 'no-microphone' })).toEqual({
      state: on({ on: false, message: 'no-microphone' }),
      command: 'stop',
    });
    const off = listenStep(on(), { type: 'error', error: 'permission-denied' }).state;
    expect(listenStep(off, { type: 'end' }).command).toBeNull();
  });

  it('other errors and a failed start switch Listen off with "Listening stopped"', () => {
    expect(listenStep(on({ interim: 'x' }), { type: 'error', error: 'other' })).toEqual({
      state: on({ on: false, message: 'stopped' }),
      command: 'stop',
    });
    expect(listenStep(on(), { type: 'start-failed' })).toEqual({
      state: on({ on: false, message: 'stopped' }),
      command: 'stop',
    });
    expect(LISTEN_MESSAGE_TEXT.stopped).toBe('Listening stopped. Turn Listen on again or type a line.');
  });

  it('no-speech and aborted change nothing, and the following end restarts', () => {
    for (const error of ['no-speech', 'aborted'] as const) {
      const after = listenStep(on(), { type: 'error', error });
      expect(after).toEqual({ state: on(), command: null });
      expect(listenStep(after.state, { type: 'end' })).toEqual({ state: on(), command: 'restart-later' });
    }
  });

  it('end while off gives no command, and stray errors while off change nothing', () => {
    const off = initialListen(true);
    expect(listenStep(off, { type: 'end' })).toEqual({ state: off, command: null });
    expect(listenStep(off, { type: 'error', error: 'other' })).toEqual({ state: off, command: null });
    expect(listenStep(off, { type: 'start-failed' })).toEqual({ state: off, command: null });
  });
});
