import { describe, expect, it } from 'vitest';
import { createFakeSpeechInput } from './fakes';
import { adaptiveSpeechInput } from './adaptive';
import { initialListen, listenStep } from './listen';
import type { RecognitionError } from './types';

function rig(supported = true) {
  const browser = createFakeSpeechInput({ supported });
  const server = createFakeSpeechInput();
  let unavailable = false;
  const session = { get: () => unavailable, set: () => { unavailable = true; } };
  const input = adaptiveSpeechInput(browser, server, session);
  return { input, browser, server, session };
}

describe('automatic transcription fallback', () => {
  it.each(['network', 'service-unavailable'] as const)('keeps Listen on after browser %s without another click', (error) => {
    const { input, browser, server, session } = rig();
    let listen = listenStep(initialListen(input.isSupported()), { type: 'toggle', on: true }).state;
    const finals: string[] = [];
    input.onError((error) => { listen = listenStep(listen, { type: 'error', error }).state; });
    input.onMode?.((mode) => { listen = listenStep(listen, { type: 'mode', server: mode === 'server' }).state; });
    input.onFinal((text) => finals.push(text));
    input.start();
    browser.emitError(error);
    browser.emitEnd();
    expect(listen).toMatchObject({ on: true, message: 'server-transcription' });
    expect(server.calls).toEqual(['start']);
    server.emitFinal('Do you need anything');
    expect(finals).toEqual(['Do you need anything']);
    input.stop();
    input.start();
    expect(browser.calls.filter((call) => call === 'start')).toHaveLength(1);
    const replacement = adaptiveSpeechInput(browser, server, session);
    replacement.start();
    expect(replacement.mode?.()).toBe('server');
  });

  it('uses capture when the browser API is absent, and makes no microphone calls before start', () => {
    const { input, browser, server } = rig(false);
    expect(input.isSupported()).toBe(true);
    expect(browser.calls).toEqual([]);
    expect(server.calls).toEqual([]);
    input.start();
    expect(server.calls).toEqual(['start']);
    input.stop();
    expect(server.calls.at(-1)).toBe('stop');
  });

  it('pauses capture, drops late events, and resumes only while Listen is on', () => {
    const { input, server } = rig(false);
    const finals: string[] = [];
    input.onFinal((text) => finals.push(text));
    input.start();
    input.setPaused?.(true);
    server.emitFinal('Dit speaking');
    expect(finals).toEqual([]);
    input.setPaused?.(false);
    server.emitFinal('partner speaking');
    expect(finals).toEqual(['partner speaking']);
    input.stop();
    input.setPaused?.(true);
    input.setPaused?.(false);
    expect(server.calls.filter((call) => call === 'start')).toHaveLength(2);
  });

  it('does not bypass a permission denial, and reports a server network error clearly', () => {
    const { input, browser, server } = rig();
    const errors: RecognitionError[] = [];
    input.onError((error) => errors.push(error));
    input.start();
    browser.emitError('permission-denied');
    expect(server.calls).toEqual([]);
    expect(errors).toEqual(['permission-denied']);
    browser.emitError('network');
    server.emitError('network');
    expect(errors).toEqual(['permission-denied', 'network']);
    const result = listenStep({ ...initialListen(true), on: true }, { type: 'error', error: 'network' });
    expect(result.state).toMatchObject({ on: false, message: 'network' });
  });
});
