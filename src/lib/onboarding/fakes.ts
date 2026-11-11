/**
 * Test fakes for the Onboarding controller (task 14.3): an Engine with scripted events, a
 * SourceControl that records its calls, and a Switch_Learner that resolves on demand.
 * Test-only: never re-exported from index.ts.
 */
import { DEFAULT_ENABLED_SOURCES, type EnabledSources, type SourceControl } from '@/lib/conversation';
import { err, type LearnError, type Result, type SourceKind, type SourceStatus, type SwitchLearner } from '@/lib/input';
import type { DecoderState, Engine, EngineConfig, EngineEvent, EstimateSnapshot } from '@/lib/morse';

// ---------------------------------------------------------------------------
// FakeEngine

export type FakeEngineCall =
  | { readonly kind: 'press' | 'release' | 'tick'; readonly t: number }
  | { readonly kind: 'reset' };

export interface FakeEngine extends Engine {
  readonly config: EngineConfig;
  readonly calls: readonly FakeEngineCall[];
  /** What nextDeadline() returns. reset() clears it, and a tick at or after it consumes it. */
  deadline: number | null;
  /** Queues the events the next call of that kind returns. */
  script(kind: 'press' | 'release' | 'tick', events: readonly EngineEvent[]): void;
  /** Runs before each press, release or tick returns, so a test can see what else has happened. */
  onCall: ((call: FakeEngineCall) => void) | null;
}

const FAKE_SNAPSHOT: EstimateSnapshot = Object.freeze({
  dotEstimate: 200,
  dashEstimate: 600,
  dotDashThreshold: 400,
  letterGapThreshold: 400,
  wordGapThreshold: 900,
});

export function createFakeEngine(config: EngineConfig = {}): FakeEngine {
  const calls: FakeEngineCall[] = [];
  const queues: Record<'press' | 'release' | 'tick', (readonly EngineEvent[])[]> = { press: [], release: [], tick: [] };
  const step = (kind: 'press' | 'release' | 'tick', t: number): readonly EngineEvent[] => {
    const call = { kind, t } as const;
    calls.push(call);
    fake.onCall?.(call);
    if (kind === 'tick' && fake.deadline !== null && t >= fake.deadline) fake.deadline = null;
    return queues[kind].shift() ?? [];
  };
  const fake: FakeEngine = {
    config,
    calls,
    deadline: null,
    onCall: null,
    mode: config.mode === 'fixed' ? 'fixed' : 'adaptive',
    script(kind, events) {
      queues[kind].push(events);
    },
    press: (t) => step('press', t),
    release: (t) => step('release', t),
    tick: (t) => step('tick', t),
    reset() {
      calls.push({ kind: 'reset' });
      fake.deadline = null;
    },
    nextDeadline: () => fake.deadline,
    estimates: () => FAKE_SNAPSHOT,
    snapshot: (): DecoderState => ({
      mode: fake.mode,
      alpha: 0.15,
      startingUnit: 200,
      estimates: { dotEstimate: FAKE_SNAPSHOT.dotEstimate, dashEstimate: FAKE_SNAPSHOT.dashEstimate },
      switchDown: false,
      pressStart: null,
      lastRelease: null,
      lastT: null,
      buffer: '',
      spaceEligible: false,
    }),
  };
  return fake;
}

/** Every Engine the controller creates, newest last. */
export function createFakeEngineFactory(): {
  readonly create: (config: EngineConfig) => FakeEngine;
  readonly engines: readonly FakeEngine[];
  current(): FakeEngine;
} {
  const engines: FakeEngine[] = [];
  return {
    create(config) {
      const engine = createFakeEngine(config);
      engines.push(engine);
      return engine;
    },
    engines,
    current() {
      const engine = engines.at(-1);
      if (engine === undefined) throw new Error('no engine was created');
      return engine;
    },
  };
}

// ---------------------------------------------------------------------------
// FakeSourceControl

export type SourceCall =
  | { readonly kind: 'startBlink' | 'stopBlink' }
  | { readonly kind: 'restore'; readonly flags: EnabledSources }
  | { readonly kind: 'setEnabled'; readonly source: Exclude<SourceKind, 'blink'>; readonly on: boolean };

export interface FakeSourceControl extends SourceControl {
  readonly calls: readonly SourceCall[];
  /** Sets one status and fires onChange. */
  setStatus(kind: SourceKind, status: SourceStatus): void;
  setFlags(flags: EnabledSources): void;
  /** Fires onChange without changing anything. */
  emit(): void;
  listenerCount(): number;
}

export function createFakeSourceControl(
  opts: { readonly flags?: EnabledSources; readonly statuses?: Partial<Record<SourceKind, SourceStatus>> } = {},
): FakeSourceControl {
  const calls: SourceCall[] = [];
  let flags: EnabledSources = opts.flags ?? DEFAULT_ENABLED_SOURCES;
  let statuses: Readonly<Record<SourceKind, SourceStatus>> = {
    keyboard: 'active',
    switch: 'active',
    pointer: 'active',
    blink: 'off',
    ...opts.statuses,
  };
  const listeners = new Set<() => void>();
  const emit = (): void => {
    for (const listener of [...listeners]) listener();
  };
  return {
    calls,
    enabled: () => flags,
    statuses: () => statuses,
    setEnabled(source, on) {
      calls.push({ kind: 'setEnabled', source, on });
      flags = { ...flags, [source]: on };
    },
    startBlink() {
      calls.push({ kind: 'startBlink' });
      flags = { ...flags, blink: true };
    },
    stopBlink() {
      calls.push({ kind: 'stopBlink' });
      flags = { ...flags, blink: false };
    },
    restore(next) {
      calls.push({ kind: 'restore', flags: next });
      flags = next;
    },
    onChange(listener) {
      const wrapped = (): void => listener();
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
    setStatus(kind, status) {
      statuses = { ...statuses, [kind]: status };
      emit();
    },
    setFlags(next) {
      flags = next;
      emit();
    },
    emit,
    listenerCount: () => listeners.size,
  };
}

// ---------------------------------------------------------------------------
// FakeSwitchLearner

export interface FakeSwitchLearner extends SwitchLearner {
  readonly arms: number;
  readonly cancels: number;
  /** Resolves the pending arm() with this result. Returns false when nothing is armed. */
  resolve(result: Result<string, LearnError>): boolean;
}

export function createFakeSwitchLearner(): FakeSwitchLearner {
  let pending: ((result: Result<string, LearnError>) => void) | null = null;
  let arms = 0;
  let cancels = 0;
  const settle = (result: Result<string, LearnError>): boolean => {
    const resolve = pending;
    pending = null;
    resolve?.(result);
    return resolve !== null;
  };
  return {
    get arms() {
      return arms;
    },
    get cancels() {
      return cancels;
    },
    arm() {
      arms += 1;
      // Like the real learner: a new arm cancels the one before it.
      settle(err({ reason: 'cancelled', message: 'Switch learning was cancelled.' }));
      return new Promise<Result<string, LearnError>>((resolve) => {
        pending = resolve;
      });
    },
    cancel() {
      cancels += 1;
      settle(err({ reason: 'cancelled', message: 'Switch learning was cancelled.' }));
    },
    isArmed: () => pending !== null,
    clear: () => ({ ok: true, value: undefined }),
    resolve: settle,
  };
}
