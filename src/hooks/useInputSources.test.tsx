// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INPUT_SETTINGS, type InputSettings, type PressEvent, type SettingsStore, type SourceKind } from '@/lib/input';
import { useInputSources, type UseInputSourcesOptions } from './useInputSources';

const mediapipe = vi.hoisted(() => ({ imports: 0 }));
vi.mock('@mediapipe/tasks-vision', () => {
  mediapipe.imports++;
  return {};
});

const ZERO_MIN: InputSettings = {
  ...DEFAULT_INPUT_SETTINGS,
  minPressDuration: { keyboard: 0, switch: 0, pointer: 0, blink: 200 },
};

function memoryStore(initial: unknown = undefined): SettingsStore & { value: unknown } {
  const store = {
    value: initial,
    readSwitchKey: () => ({ ok: true as const, value: store.value }),
    writeSwitchKey: (code: string) => {
      store.value = code;
      return { ok: true as const, value: undefined };
    },
    clearSwitchKey: () => {
      store.value = undefined;
      return { ok: true as const, value: undefined };
    },
  };
  return store;
}

type ListenerKey = string;
const live = new Map<ListenerKey, number>();
const keyOf = (target: string, type: string, capture: boolean): ListenerKey => `${target}:${type}:${capture}`;
const captureOf = (options?: boolean | AddEventListenerOptions | EventListenerOptions): boolean =>
  typeof options === 'boolean' ? options : options?.capture === true;

/** Event types the input layer listens to; React's own document listeners are left out. */
const INPUT_EVENT_TYPES = new Set([
  'keydown',
  'keyup',
  'blur',
  'visibilitychange',
  'pointerdown',
  'pointerup',
  'pointercancel',
  'lostpointercapture',
  'contextmenu',
]);

/** Counts live input-layer listeners on window, document and the surface. */
function trackListeners(target: EventTarget, name: string): void {
  const add = target.addEventListener.bind(target);
  const remove = target.removeEventListener.bind(target);
  const count = (type: string, options: boolean | AddEventListenerOptions | EventListenerOptions | undefined, delta: number) => {
    if (!INPUT_EVENT_TYPES.has(type)) return;
    const key = keyOf(name, type, captureOf(options));
    live.set(key, (live.get(key) ?? 0) + delta);
  };
  vi.spyOn(target, 'addEventListener').mockImplementation((type, listener, options) => {
    count(type, options, 1);
    add(type, listener, options);
  });
  vi.spyOn(target, 'removeEventListener').mockImplementation((type, listener, options) => {
    count(type, options, -1);
    remove(type, listener, options);
  });
}

let surface: HTMLDivElement;
let getUserMedia = vi.fn();

beforeEach(() => {
  live.clear();
  surface = document.createElement('div');
  surface.setAttribute('role', 'button');
  surface.setAttribute('aria-label', 'Keying surface');
  surface.tabIndex = 0;
  document.body.appendChild(surface);
  getUserMedia = vi.fn();
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
  trackListeners(window, 'window');
  trackListeners(document, 'document');
  trackListeners(surface, 'surface');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  surface.remove();
});

function options(overrides: Partial<UseInputSourcesOptions> = {}): UseInputSourcesOptions {
  return {
    surfaceRef: { current: surface },
    enabled: { keyboard: true, switch: true, pointer: true, blink: false },
    settings: ZERO_MIN,
    store: memoryStore(),
    onPress: () => undefined,
    ...overrides,
  };
}

const enabledWith = (flags: Partial<Record<SourceKind, boolean>>): Record<SourceKind, boolean> => ({
  keyboard: false,
  switch: false,
  pointer: false,
  blink: false,
  ...flags,
});

describe('useInputSources', () => {
  it('never starts blink on mount and loads no MediaPipe code (Req 9.1)', () => {
    const { result } = renderHook(() => useInputSources(options()));
    expect(result.current.statuses).toStrictEqual({ keyboard: 'active', switch: 'active', pointer: 'active', blink: 'off' });
    expect(mediapipe.imports).toBe(0);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('starts and stops sources from the enabled flags', () => {
    const { result, rerender } = renderHook((props: UseInputSourcesOptions) => useInputSources(props), {
      initialProps: options({ enabled: enabledWith({ keyboard: true }) }),
    });
    expect(result.current.statuses.keyboard).toBe('active');
    expect(result.current.statuses.pointer).toBe('off');

    rerender(options({ enabled: enabledWith({ pointer: true }) }));
    expect(result.current.statuses).toMatchObject({ keyboard: 'off', pointer: 'active' });
    expect(surface.style.getPropertyValue('touch-action')).toBe('none');

    rerender(options({ enabled: enabledWith({}) }));
    expect(result.current.statuses).toStrictEqual({ keyboard: 'off', switch: 'off', pointer: 'off', blink: 'off' });
    expect(surface.style.getPropertyValue('touch-action')).toBe('');
  });

  it('forwards Space on the body to onPress in order, and leaves Space on a button alone', () => {
    const presses: PressEvent[] = [];
    renderHook(() => useInputSources(options({ onPress: (event) => presses.push(event) })));
    fireEvent.keyDown(document.body, { code: 'Space' });
    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(presses.map((event) => `${event.kind}:${event.source}`)).toStrictEqual(['down:keyboard', 'up:keyboard']);
    expect(presses[1]?.t).toBeGreaterThanOrEqual(presses[0]?.t ?? Infinity);

    const button = document.createElement('button');
    document.body.appendChild(button);
    button.focus();
    const keydown = new KeyboardEvent('keydown', { code: 'Space', bubbles: true, cancelable: true });
    button.dispatchEvent(keydown);
    expect(keydown.defaultPrevented).toBe(false);
    expect(presses).toHaveLength(2);
    button.remove();
  });

  it('keys Morse with a pointer press on the surface', () => {
    const presses: PressEvent[] = [];
    renderHook(() => useInputSources(options({ onPress: (event) => presses.push(event) })));
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;
    fireEvent.pointerDown(surface, { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0 });
    fireEvent.pointerUp(surface, { pointerId: 1, isPrimary: true, pointerType: 'touch', button: 0 });
    expect(presses.map((event) => `${event.kind}:${event.source}`)).toStrictEqual(['down:pointer', 'up:pointer']);
  });

  it('exposes a live pendingSince and pending changes', () => {
    const changes: (number | null)[] = [];
    const { result } = renderHook(() => useInputSources(options({ settings: DEFAULT_INPUT_SETTINGS })));
    result.current.onPendingChange((since) => changes.push(since));
    expect(result.current.pendingSince()).toBeNull();
    fireEvent.keyDown(document.body, { code: 'Enter' });
    const since = result.current.pendingSince();
    expect(typeof since).toBe('number');
    fireEvent.keyUp(document.body, { code: 'Enter' });
    expect(result.current.pendingSince()).toBeNull();
    expect(changes).toStrictEqual([since, null]);
  });

  it('sends presses to the newest onPress without reconnecting anything', () => {
    const first: PressEvent[] = [];
    const second: PressEvent[] = [];
    const { rerender } = renderHook((props: UseInputSourcesOptions) => useInputSources(props), {
      initialProps: options({ onPress: (event) => first.push(event) }),
    });
    const added = (window.addEventListener as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    rerender(options({ onPress: (event) => second.push(event) }));
    fireEvent.keyDown(document.body, { code: 'Space' });
    expect(first).toHaveLength(0);
    expect(second).toHaveLength(1);
    expect((window.addEventListener as unknown as { mock: { calls: unknown[] } }).mock.calls.length).toBe(added);
  });

  it('learns a switch key that then keys Morse, and shows it', async () => {
    const presses: PressEvent[] = [];
    const store = memoryStore();
    const { result } = renderHook(() => useInputSources(options({ store, onPress: (event) => presses.push(event) })));
    const learner = result.current.learner;
    let learning: ReturnType<typeof learner.arm> | null = null;
    act(() => {
      learning = learner.arm();
    });
    fireEvent.keyDown(document.body, { code: 'KeyJ' });
    fireEvent.keyUp(document.body, { code: 'KeyJ' });
    await act(async () => {
      expect(await learning).toStrictEqual({ ok: true, value: 'KeyJ' });
    });
    expect(result.current.learnedKey).toBe('KeyJ');
    expect(result.current.learner).toBe(learner);
    expect(store.value).toBe('KeyJ');
    expect(presses).toHaveLength(0);

    fireEvent.keyDown(document.body, { code: 'KeyJ' });
    expect(presses.map((event) => event.source)).toStrictEqual(['switch']);
  });

  it('reads the stored switch key on start', () => {
    const { result } = renderHook(() => useInputSources(options({ store: memoryStore('F13') })));
    expect(result.current.learnedKey).toBe('F13');
  });

  it('leaves no listeners and no armed learner after unmount', async () => {
    const presses: PressEvent[] = [];
    const { result, unmount } = renderHook(() => useInputSources(options({ onPress: (event) => presses.push(event) })));
    fireEvent.keyDown(document.body, { code: 'Space' });
    const learning = result.current.learner.arm();
    // Unmounting while Held ends the press with one up, and cancels the armed learner.
    unmount();
    await expect(learning).resolves.toMatchObject({ ok: false, error: { reason: 'cancelled' } });
    expect([...live.entries()].filter(([, count]) => count !== 0)).toStrictEqual([]);
    fireEvent.keyDown(document.body, { code: 'Enter' });
    expect(presses.map((event) => event.kind)).toStrictEqual(['down', 'up']);
  });

  it('works under StrictMode double mounting', () => {
    const presses: PressEvent[] = [];
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;
    const { result, unmount } = renderHook(() => useInputSources(options({ onPress: (event) => presses.push(event) })), {
      wrapper,
    });
    expect(result.current.statuses.keyboard).toBe('active');
    fireEvent.keyDown(document.body, { code: 'Space' });
    fireEvent.keyUp(document.body, { code: 'Space' });
    expect(presses.map((event) => event.kind)).toStrictEqual(['down', 'up']);
    unmount();
    expect([...live.entries()].filter(([, count]) => count !== 0)).toStrictEqual([]);
  });
});
