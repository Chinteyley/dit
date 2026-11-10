/**
 * Test rig for the SessionController: every dependency is a fake, the clock is manual, and the
 * Tick_Timer has its own inspectable scheduler (the Live_Region and Listen timers use another),
 * so `scheduler.pending()` counts Tick_Timers only. Test-only.
 */
import {
  createConversationStorage,
  memoryBackend,
  type ConversationStorage,
  type KeyValueBackend,
} from '@/lib/conversation';
import {
  createFakeAlarmHandler,
  createFakeClient,
  createInspectableScheduler,
  createFakeUnknownPatternHandler,
  fakeEngineFactory,
  type FakeAlarmHandler,
  type FakeClient,
  type FakeEngine,
  type FakeUnknownPatternHandler,
  type InspectableScheduler,
} from '@/lib/conversation/test-support';
import { createManualClock, pressEvent, type ManualClock, type PressEvent, type SourceKind } from '@/lib/input';
import type { EngineEvent } from '@/lib/morse';
import { createFakeSpeechInput, createFakeSpeechOutput, type FakeSpeechInput, type FakeSpeechOutput } from '@/lib/speech/fakes';
import { createSessionController, type ControllerDeps, type SessionController } from './session-controller';

export interface ControllerRig {
  readonly clock: ManualClock;
  /** Tick_Timers only. */
  readonly scheduler: InspectableScheduler;
  /** Live_Region flush and Listen restart timers. */
  readonly ui: InspectableScheduler;
  readonly engines: ReturnType<typeof fakeEngineFactory>;
  readonly client: FakeClient;
  readonly speechOutput: FakeSpeechOutput;
  readonly speechInput: FakeSpeechInput;
  readonly alarm: FakeAlarmHandler;
  readonly unknown: FakeUnknownPatternHandler;
  readonly backend: KeyValueBackend;
  readonly storage: ConversationStorage;
  /** Raw_Down times the fake arbiter reports as pending; pendingSince() is their minimum. */
  readonly pending: number[];
  readonly controller: SessionController;
  /** The current Engine. */
  engine(): FakeEngine;
  /** Queues the events returned by the next Engine call (press, release or tick). */
  script(...events: EngineEvent[]): void;
  down(t?: number, source?: SourceKind): PressEvent;
  up(t?: number, source?: SourceKind): PressEvent;
  /** Moves the clock forward and runs every due timer on both schedulers. */
  advance(ms: number): void;
}

export interface RigOptions {
  readonly backend?: KeyValueBackend;
  readonly speechOutput?: FakeSpeechOutput;
  readonly speechInput?: FakeSpeechInput;
  /** Use one scheduler for every timer, as production does. */
  readonly sharedScheduler?: boolean;
  readonly start?: number;
  /** Passed to ControllerDeps.persistent. */
  readonly persistent?: boolean;
}

export function createControllerRig(opts: RigOptions = {}): ControllerRig {
  const clock = createManualClock(opts.start ?? 1_000);
  const scheduler = createInspectableScheduler(clock.now);
  const ui = opts.sharedScheduler === true ? scheduler : createInspectableScheduler(clock.now);
  const engines = fakeEngineFactory();
  const client = createFakeClient();
  const speechOutput = opts.speechOutput ?? createFakeSpeechOutput();
  const speechInput = opts.speechInput ?? createFakeSpeechInput();
  const alarm = createFakeAlarmHandler();
  const unknown = createFakeUnknownPatternHandler();
  const backend = opts.backend ?? memoryBackend();
  const storage = createConversationStorage(backend);
  const pending: number[] = [];
  const deps: ControllerDeps = {
    clock: clock.now,
    scheduler,
    ...(opts.sharedScheduler === true ? {} : { uiScheduler: ui }),
    createEngine: engines.create,
    pendingSince: () => (pending.length === 0 ? null : Math.min(...pending)),
    createClient: client.create,
    speechOutput,
    speechInput,
    alarm,
    unknownPattern: unknown,
    storage,
    ...(opts.persistent === undefined ? {} : { persistent: opts.persistent }),
  };
  const controller = createSessionController(deps);
  const press = (kind: 'down' | 'up', t: number | undefined, source: SourceKind): PressEvent => {
    const event = pressEvent(kind, t ?? clock.now(), source);
    controller.handlePress(event);
    return event;
  };
  return {
    clock,
    scheduler,
    ui,
    engines,
    client,
    speechOutput,
    speechInput,
    alarm,
    unknown,
    backend,
    storage,
    pending,
    controller,
    engine: () => engines.current(),
    script: (...events) => {
      engines.script.push(events);
    },
    down: (t, source = 'keyboard') => press('down', t, source),
    up: (t, source = 'keyboard') => press('up', t, source),
    advance(ms) {
      clock.advance(ms);
      scheduler.runDue(clock.now());
      if (ui !== scheduler) ui.runDue(clock.now());
    },
  };
}

export const char = (c: string): EngineEvent => ({ type: 'char', char: c });
export const SPACE: EngineEvent = { type: 'space' };
export const SPEAK: EngineEvent = { type: 'command', command: 'speak' };
export const NEXT: EngineEvent = { type: 'command', command: 'next' };
export const BACKSPACE: EngineEvent = { type: 'command', command: 'backspace' };
export const SOS: EngineEvent = { type: 'command', command: 'sos' };
export const symbol = (s: '.' | '-'): EngineEvent => ({ type: 'symbol', symbol: s });
