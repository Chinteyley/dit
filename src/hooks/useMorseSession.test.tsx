// @vitest-environment jsdom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { StrictMode, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createConversationStorage,
  inertAlarmHandler,
  inertUnknownPatternHandler,
  memoryBackend,
} from '@/lib/conversation';
import { createFakeClient, fakeEngineFactory, type FakeClient } from '@/lib/conversation/test-support';
import type { ExpansionResult } from '@/lib/expansion';
import { createManualClock, createManualScheduler, pressEvent } from '@/lib/input';
import type { Estimates } from '@/lib/morse';
import { createFakeSpeechInput, createFakeSpeechOutput } from '@/lib/speech/fakes';
import { SAVE_FAILED_TEXT } from './session-controller';
import { INITIAL_SNAPSHOT, useMorseSession, type UseMorseSessionOptions } from './useMorseSession';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function fakes() {
  const clock = createManualClock(1_000);
  const scheduler = createManualScheduler(clock.now);
  const engines = fakeEngineFactory();
  const clients: FakeClient[] = [];
  const createClient = (onResult: (result: ExpansionResult) => void) => {
    const client = createFakeClient();
    clients.push(client);
    return client.create(onResult);
  };
  const speechOutput = createFakeSpeechOutput();
  const speechInput = createFakeSpeechInput();
  const storage = createConversationStorage(memoryBackend());
  const options = (pendingSince: () => number | null = () => null): UseMorseSessionOptions => ({
    alarm: inertAlarmHandler(),
    unknownPattern: inertUnknownPatternHandler(),
    pendingSince,
    clock: clock.now,
    overrides: { scheduler, createEngine: engines.create, createClient, speechOutput, speechInput, storage },
  });
  return { clock, scheduler, engines, clients, createClient, speechOutput, speechInput, storage, options };
}

describe('useMorseSession', () => {
  it('creates the controller after mount and updates the snapshot after a press', () => {
    const f = fakes();
    const { result } = renderHook(() => useMorseSession(f.options()));
    expect(result.current.ready).toBe(true);
    expect(f.engines.engines).toHaveLength(1);
    f.engines.script.push([{ type: 'symbol', symbol: '.' }]);
    act(() => result.current.controller.handlePress(pressEvent('down', 1_000, 'keyboard')));
    expect(result.current.snapshot.pressed).toBe(true);
    expect(result.current.snapshot.session.currentPattern).toBe('.');
    f.engines.script.push([{ type: 'char', char: 'e' }]);
    act(() => result.current.controller.handlePress(pressEvent('up', 1_100, 'keyboard')));
    expect(result.current.snapshot.pressed).toBe(false);
    expect(result.current.snapshot.session.currentText).toBe('e');
  });

  it('returns the storage the controller uses', () => {
    const f = fakes();
    const { result } = renderHook(() => useMorseSession(f.options()));
    expect(result.current.storage).toBe(f.storage);
  });

  it('disposes the controller on unmount and leaves no timer scheduled (Req 8.13)', () => {
    const f = fakes();
    const { result, unmount } = renderHook(() => useMorseSession(f.options()));
    f.engines.current().deadline = 1_500;
    act(() => result.current.controller.handlePress(pressEvent('down', 1_000, 'keyboard')));
    expect(f.scheduler.pending()).toBe(1);
    act(() => result.current.controller.setListen(true));
    expect(f.speechInput.calls).toStrictEqual(['start']);
    unmount();
    expect(f.scheduler.pending()).toBe(0);
    expect(f.clients[0]?.disposed).toBe(true);
    expect(f.speechInput.calls.at(-1)).toBe('stop');
    expect(f.speechInput.listenerCount()).toBe(0);
    expect(f.speechOutput.listenerCount()).toBe(0);
  });

  it('keeps the controller when a rerender brings a new pendingSince, and reads the newest at timer time', () => {
    const f = fakes();
    const first = vi.fn(() => null);
    const second = vi.fn(() => null);
    const { result, rerender } = renderHook((pending: () => number | null) => useMorseSession(f.options(pending)), {
      initialProps: first,
    });
    const controller = result.current.controller;
    rerender(second);
    expect(result.current.controller).toBe(controller);
    expect(f.engines.engines).toHaveLength(1);
    expect(f.clients).toHaveLength(1);
    f.engines.current().deadline = 1_200;
    act(() => controller.handlePress(pressEvent('up', 1_000, 'keyboard')));
    act(() => {
      f.clock.advance(200);
      f.scheduler.runDue(f.clock.now());
    });
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    expect(f.engines.current().calls.at(-1)).toStrictEqual({ kind: 'tick', t: 1_200 });
  });

  it('survives the strict-mode double mount with one live controller', () => {
    const f = fakes();
    let latest: ReturnType<typeof useMorseSession> | null = null;
    function Probe() {
      latest = useMorseSession(f.options());
      return <p>{latest.snapshot.session.currentText}</p>;
    }
    const view = render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    // Mount, the simulated unmount (dispose), then the real mount.
    expect(f.clients).toHaveLength(2);
    expect(f.clients[0]?.disposed).toBe(true);
    expect(f.clients[1]?.disposed).toBe(false);
    f.engines.script.push([{ type: 'char', char: 't' }]);
    act(() => latest?.controller.handlePress(pressEvent('down', 1_000, 'keyboard')));
    expect(view.container.textContent).toBe('t');
  });

  it('applies initial estimates set before the controller exists (onboarding O11.4)', () => {
    const f = fakes();
    const estimates: Estimates = { dotEstimate: 150, dashEstimate: 450 };
    function Child({ api }: { readonly api: ReturnType<typeof useMorseSession> }) {
      // Child effects run before the parent's, so the controller does not exist yet here.
      useEffect(() => {
        api.controller.setInitialEstimates(estimates);
      }, [api.controller]);
      return null;
    }
    function Parent() {
      const api = useMorseSession(f.options());
      return <Child api={api} />;
    }
    render(<Parent />);
    const latest = f.engines.current();
    expect(latest.config.initialDotEstimate).toBe(150);
    expect(latest.config.initialDashEstimate).toBe(450);
  });

  it('forwards onCharCommitted listeners registered before the controller exists', () => {
    const f = fakes();
    const seen: string[] = [];
    function Child({ api }: { readonly api: ReturnType<typeof useMorseSession> }) {
      useEffect(() => api.controller.onCharCommitted((char) => seen.push(char)), [api.controller]);
      return null;
    }
    let controller: ReturnType<typeof useMorseSession>['controller'] | null = null;
    function Parent() {
      const api = useMorseSession(f.options());
      controller = api.controller;
      return <Child api={api} />;
    }
    render(<Parent />);
    f.engines.script.push([{ type: 'char', char: 'a' }]);
    act(() => controller?.handlePress(pressEvent('down', 1_000, 'keyboard')));
    expect(seen).toStrictEqual(['a']);
  });

  it('falls back to memory and shows the save-failure message once when localStorage is unavailable (Req 16.9)', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('storage is disabled');
    });
    const f = fakes();
    // Everything but the storage is a fake, so the hook builds its own storage.
    const overrides = {
      scheduler: f.scheduler,
      createEngine: f.engines.create,
      createClient: f.createClient,
      speechOutput: f.speechOutput,
      speechInput: f.speechInput,
    };
    const { result } = renderHook(() => useMorseSession({ ...f.options(), overrides }));
    const saveFailed = result.current.snapshot.messages.filter((message) => message.id === 'save-failed');
    expect(saveFailed).toStrictEqual([{ id: 'save-failed', text: SAVE_FAILED_TEXT }]);
    expect(result.current.storage).not.toBe(f.storage);
  });

  it('renders the initial snapshot on the server and before mount', () => {
    expect(INITIAL_SNAPSHOT.session.currentText).toBe('');
    expect(INITIAL_SNAPSHOT.listen.on).toBe(false);
    expect(INITIAL_SNAPSHOT.messages).toStrictEqual([]);
  });
});
