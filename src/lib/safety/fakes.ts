/**
 * Test fakes for the safety runtime (design "Fakes"): an audio port with a manual audio clock, a
 * Web Audio context that records every node and parameter call, a chime player and a card view.
 * Test-only: never re-exported from index.ts.
 */
import type { Unsubscribe } from '@/lib/input';
import type { CardView } from './alarm-handler';
import type { AudioPort, AudioState, ChimePlayer, ChimeVoice } from './chime-player';

// ---------------------------------------------------------------------------
// FakeAudioPort (task 12.2)

export interface FakeChimeRequest {
  /** The Chime start time passed to playChime. */
  readonly t: number;
  /** The audio clock when it was requested. */
  readonly at: number;
  /** Every silence(t) call on the returned voice. */
  readonly silenced: readonly number[];
}

export interface FakeAudioPort extends AudioPort {
  /** Successful playChime calls, in order. */
  readonly requests: readonly FakeChimeRequest[];
  /** Every playChime call, including one that threw. */
  readonly playAttempts: number;
  readonly resumes: number;
  readonly ensureCalls: number;
  readonly unlocks: number;
  /** What ensureContext() returns; false gives state 'none'. */
  available: boolean;
  /** 1-based playChime call that throws, or null. */
  throwOnPlay: number | null;
  /** Sets the state and tells every onStateChange listener. */
  setState(state: AudioState): void;
  setNow(ms: number): void;
  advance(ms: number): void;
  listenerCount(): number;
  unlockSilently(): void;
}

export function createFakeAudioPort(
  opts: { readonly state?: AudioState; readonly now?: number; readonly available?: boolean; readonly throwOnPlay?: number } = {},
): FakeAudioPort {
  let state: AudioState = opts.state ?? 'running';
  let now = opts.now ?? 0;
  let created = false;
  let playAttempts = 0;
  let resumes = 0;
  let ensureCalls = 0;
  let unlocks = 0;
  const requests: { t: number; at: number; silenced: number[] }[] = [];
  const listeners = new Set<(s: AudioState) => void>();

  const port: FakeAudioPort = {
    requests,
    get playAttempts() {
      return playAttempts;
    },
    get resumes() {
      return resumes;
    },
    get ensureCalls() {
      return ensureCalls;
    },
    get unlocks() {
      return unlocks;
    },
    available: opts.available ?? true,
    throwOnPlay: opts.throwOnPlay ?? null,
    ensureContext() {
      ensureCalls += 1;
      if (port.available) created = true;
      return port.available;
    },
    state: () => (created || port.available ? state : 'none'),
    now: () => (port.available ? now : null),
    resume() {
      resumes += 1;
    },
    onStateChange(listener) {
      const wrapped = (s: AudioState): void => listener(s);
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    playChime(t): ChimeVoice {
      playAttempts += 1;
      if (port.throwOnPlay !== null && playAttempts === port.throwOnPlay) throw new Error('Web Audio failed');
      const request = { t, at: now, silenced: [] as number[] };
      requests.push(request);
      return {
        silence(atMs) {
          request.silenced.push(atMs);
        },
      };
    },
    setState(next) {
      state = next;
      for (const listener of [...listeners]) listener(next);
    },
    setNow(ms) {
      now = ms;
    },
    advance(ms) {
      now += ms;
    },
    listenerCount: () => listeners.size,
    unlockSilently() {
      unlocks += 1;
    },
  };
  return port;
}

// ---------------------------------------------------------------------------
// FakePageVisibility

export interface FakePageVisibility {
  hidden(): boolean;
  onChange(listener: () => void): Unsubscribe;
  setHidden(hidden: boolean): void;
  listenerCount(): number;
}

export function createFakePageVisibility(hidden = false): FakePageVisibility {
  let isHidden = hidden;
  const listeners = new Set<() => void>();
  return {
    hidden: () => isHidden,
    onChange(listener) {
      const wrapped = (): void => listener();
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    setHidden(next) {
      if (next === isHidden) return;
      isHidden = next;
      for (const listener of [...listeners]) listener();
    },
    listenerCount: () => listeners.size,
  };
}

// ---------------------------------------------------------------------------
// FakeAudioContext (task 12.2), shaped like the parts of Web Audio that browser.ts uses

export type FakeParamCall =
  | { readonly method: 'setValueAtTime' | 'linearRampToValueAtTime'; readonly value: number; readonly time: number }
  | { readonly method: 'cancelScheduledValues'; readonly time: number };

export class FakeAudioParam {
  readonly calls: FakeParamCall[] = [];
  constructor(public value: number) {}
  setValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'setValueAtTime', value, time });
    return this;
  }
  linearRampToValueAtTime(value: number, time: number): this {
    this.calls.push({ method: 'linearRampToValueAtTime', value, time });
    return this;
  }
  cancelScheduledValues(time: number): this {
    this.calls.push({ method: 'cancelScheduledValues', time });
    return this;
  }
}

export class FakeAudioNode {
  readonly connections: FakeAudioNode[] = [];
  disconnected = false;
  constructor(readonly kind: 'destination' | 'oscillator' | 'gain' | 'buffer-source') {}
  connect<T extends FakeAudioNode>(destination: T): T {
    this.connections.push(destination);
    return destination;
  }
  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeOscillator extends FakeAudioNode {
  type = 'sine';
  readonly frequency = new FakeAudioParam(440);
  readonly startTimes: number[] = [];
  readonly stopTimes: number[] = [];
  onended: (() => void) | null = null;
  constructor() {
    super('oscillator');
  }
  start(when = 0): void {
    this.startTimes.push(when);
  }
  stop(when = 0): void {
    this.stopTimes.push(when);
  }
}

export class FakeGain extends FakeAudioNode {
  readonly gain = new FakeAudioParam(1);
  constructor() {
    super('gain');
  }
}

export interface FakeAudioBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
}

export class FakeBufferSource extends FakeAudioNode {
  buffer: FakeAudioBuffer | null = null;
  readonly startTimes: number[] = [];
  constructor() {
    super('buffer-source');
  }
  start(when = 0): void {
    this.startTimes.push(when);
  }
}

export interface FakeAudioContextOptions {
  /** 'suspended' by default, as for a context created outside a user gesture. */
  readonly state?: string;
  /** What resume() does: resolve and switch to running (default), reject, or throw. */
  readonly resume?: 'resolve' | 'reject' | 'throw' | 'stay';
  /** The constructor throws. */
  readonly throwOnCreate?: boolean;
}

export class FakeAudioContext {
  state: string;
  currentTime = 0;
  readonly sampleRate = 48_000;
  readonly destination = new FakeAudioNode('destination');
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly buffers: FakeAudioBuffer[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  resumeCalls = 0;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly opts: FakeAudioContextOptions = {}) {
    this.state = opts.state ?? 'suspended';
  }

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): FakeAudioBuffer {
    const buffer = { numberOfChannels, length, sampleRate };
    this.buffers.push(buffer);
    return buffer;
  }

  createBufferSource(): FakeBufferSource {
    const node = new FakeBufferSource();
    this.bufferSources.push(node);
    return node;
  }

  resume(): Promise<void> {
    this.resumeCalls += 1;
    const mode = this.opts.resume ?? 'resolve';
    if (mode === 'throw') throw new Error('resume failed');
    if (mode === 'reject') return Promise.reject(new Error('resume rejected'));
    if (mode === 'resolve') this.setState('running');
    return Promise.resolve();
  }

  addEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.add(listener);
  }

  removeEventListener(type: string, listener: () => void): void {
    if (type === 'statechange') this.listeners.delete(listener);
  }

  setState(state: string): void {
    if (this.state === state) return;
    this.state = state;
    for (const listener of [...this.listeners]) listener();
  }
}

export interface FakeGestureEvent {
  readonly type: string;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

interface Registration {
  readonly type: string;
  readonly listener: (event: FakeGestureEvent) => void;
  readonly options: unknown;
}

export interface FakeAudioWindow {
  readonly AudioContext?: new () => FakeAudioContext;
  readonly webkitAudioContext?: new () => FakeAudioContext;
  addEventListener(type: string, listener: (event: FakeGestureEvent) => void, options?: unknown): void;
  removeEventListener(type: string, listener: (event: FakeGestureEvent) => void, options?: unknown): void;
}

/** A window with an AudioContext constructor (or the webkit one, or none) and recordable listeners. */
export function createFakeAudioWindow(
  opts: FakeAudioContextOptions & { readonly ctor?: 'standard' | 'webkit' | 'none' } = {},
): {
  readonly win: FakeAudioWindow;
  readonly contexts: readonly FakeAudioContext[];
  readonly registrations: readonly Registration[];
  /** Dispatches a gesture to every listener of that type and returns the event. */
  dispatch(type: string): FakeGestureEvent;
} {
  const contexts: FakeAudioContext[] = [];
  const registrations: Registration[] = [];
  class Ctor extends FakeAudioContext {
    constructor() {
      if (opts.throwOnCreate === true) throw new Error('AudioContext is not allowed');
      super(opts);
      contexts.push(this);
    }
  }
  const ctor = opts.ctor ?? 'standard';
  const win: FakeAudioWindow = {
    ...(ctor === 'standard' ? { AudioContext: Ctor } : {}),
    ...(ctor === 'webkit' ? { webkitAudioContext: Ctor } : {}),
    addEventListener(type, listener, options) {
      registrations.push({ type, listener, options });
    },
    removeEventListener(type, listener) {
      const i = registrations.findIndex((r) => r.type === type && r.listener === listener);
      if (i !== -1) registrations.splice(i, 1);
    },
  };
  return {
    win,
    contexts,
    registrations,
    dispatch(type) {
      const event: FakeGestureEvent = {
        type,
        defaultPrevented: false,
        propagationStopped: false,
        preventDefault() {
          event.defaultPrevented = true;
        },
        stopPropagation() {
          event.propagationStopped = true;
        },
        stopImmediatePropagation() {
          event.propagationStopped = true;
        },
      };
      for (const r of registrations.filter((reg) => reg.type === type)) r.listener(event);
      return event;
    },
  };
}

// ---------------------------------------------------------------------------
// FakeChimePlayer and FakeCardView (tasks 12.2 and 13.2)

export interface FakeChimePlayer extends ChimePlayer {
  readonly calls: readonly ('start' | 'stop')[];
  throwOnStart: boolean;
  setSoundUnavailable(value: boolean): void;
}

export function createFakeChimePlayer(opts: { readonly throwOnStart?: boolean } = {}): FakeChimePlayer {
  const calls: ('start' | 'stop')[] = [];
  const listeners = new Set<() => void>();
  let unavailable = false;
  const player: FakeChimePlayer = {
    calls,
    throwOnStart: opts.throwOnStart ?? false,
    start() {
      calls.push('start');
      if (player.throwOnStart) throw new Error('chime failed');
    },
    stop() {
      calls.push('stop');
    },
    soundUnavailable: () => unavailable,
    onSoundChange(listener) {
      const wrapped = (): void => listener();
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    setSoundUnavailable(value) {
      unavailable = value;
      for (const listener of [...listeners]) listener();
    },
  };
  return player;
}

export interface FakeCardView extends CardView {
  readonly calls: readonly ('show' | 'hide')[];
  throwOnShow: boolean;
}

export function createFakeCardView(opts: { readonly throwOnShow?: boolean } = {}): FakeCardView {
  const calls: ('show' | 'hide')[] = [];
  const view: FakeCardView = {
    calls,
    throwOnShow: opts.throwOnShow ?? false,
    show() {
      calls.push('show');
      if (view.throwOnShow) throw new Error('card failed');
    },
    hide() {
      calls.push('hide');
    },
  };
  return view;
}
