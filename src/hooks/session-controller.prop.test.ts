import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HISTORY_KEY, contextWindow, memoryBackend, trimmedText, type SessionState } from '@/lib/conversation';
import {
  PROP_RUNS,
  arbHistoryRecord,
  arbSuggestionText,
  engineEventArb,
  nearMiss,
  partnerLineTextArb,
  pickIndexArb,
  sourceArb,
  type EngineCall,
  type NearMiss,
} from '@/lib/conversation/test-support';
import type { PressEvent } from '@/lib/input';
import type { EngineEvent } from '@/lib/morse';
import { PENDING_RETRY_MS } from './session-controller';
import { createControllerRig, type ControllerRig } from './session-controller.test-support';

const isSpeak = (event: EngineEvent): boolean => event.type === 'command' && event.command === 'speak';
const isSos = (event: EngineEvent): boolean => event.type === 'command' && event.command === 'sos';

/** Engine events without sos (the alarm is Property 20's subject). */
const nonAlarmEventArb = engineEventArb.filter((event) => !isSos(event));
const eventListArb = (events: fc.Arbitrary<EngineEvent>) => fc.array(events, { maxLength: 3 });

// ---------------------------------------------------------------------------------------------
// Property 19: one Tick_Timer, never ticking past a pending press

interface TimerModel {
  now: number;
  pending: number[];
  /** The arbiter alternates down and up. */
  down: boolean;
  engineHeld: boolean;
  withholdUp: boolean;
  /** What the current fake Engine's nextDeadline() returns. */
  engineDeadline: number | null;
  /** The expected single Tick_Timer. */
  timer: { due: number; deadline: number } | null;
  /** Mirror of the shared engine script. */
  script: EngineEvent[][];
  /** Expected tick timestamps, in order. */
  ticks: number[];
}

const minPending = (m: TimerModel): number | null => (m.pending.length === 0 ? null : Math.min(...m.pending));

function modelReschedule(m: TimerModel): void {
  m.timer = m.engineDeadline === null ? null : { due: Math.max(m.engineDeadline, m.now), deadline: m.engineDeadline };
}

/** An Engine call returned the next scripted events; a speak command resets the Engine. */
function modelEngineCall(m: TimerModel): void {
  const events = m.script.shift() ?? [];
  if (events.some(isSpeak)) m.engineDeadline = null;
}

function modelPress(m: TimerModel, kind: 'down' | 'up'): void {
  if (kind === 'down') {
    m.withholdUp = false;
    m.down = true;
  } else {
    m.down = false;
    if (m.withholdUp) {
      m.withholdUp = false;
      return;
    }
  }
  modelEngineCall(m);
  m.engineHeld = kind === 'down';
  modelReschedule(m);
}

function realTicks(r: ControllerRig): number[] {
  return r.engines.engines.flatMap((engine) =>
    engine.calls.flatMap((call: EngineCall) => (call.kind === 'tick' ? [call.t] : [])),
  );
}

function checkTimers(m: TimerModel, r: ControllerRig, label: string): void {
  expect(r.scheduler.pending(), `${label}: more than one Tick_Timer`).toBeLessThanOrEqual(1);
  expect(r.scheduler.live().map((timer) => timer.due), `${label}: Tick_Timer`).toEqual(m.timer === null ? [] : [m.timer.due]);
  expect(realTicks(r), `${label}: tick timestamps`).toEqual(m.ticks);
  expect(r.engine().nextDeadline(), `${label}: engine deadline`).toBe(m.engineDeadline);
}

type TimerCommand = fc.Command<TimerModel, ControllerRig>;

const timerCommands: fc.Arbitrary<TimerCommand>[] = [
  fc.constant<TimerCommand>({
    check: (m) => !m.down,
    run(m, r) {
      r.down();
      modelPress(m, 'down');
      checkTimers(m, r, 'Down');
    },
    toString: () => 'Down',
  }),
  fc.constant<TimerCommand>({
    check: (m) => m.down,
    run(m, r) {
      r.up();
      modelPress(m, 'up');
      checkTimers(m, r, 'Up');
    },
    toString: () => 'Up',
  }),
  fc.integer({ min: 0, max: 300 }).map<TimerCommand>((offset) => ({
    check: () => true,
    run(m, r) {
      const rawDown = m.now - offset;
      m.pending.push(rawDown);
      r.pending.push(rawDown);
      checkTimers(m, r, 'PendingStart');
    },
    toString: () => `PendingStart(-${offset})`,
  })),
  fc.boolean().map<TimerCommand>((confirm) => ({
    check: (m) => m.pending.length > 0,
    run(m, r) {
      const earliest = minPending(m) ?? m.now;
      m.pending.splice(m.pending.indexOf(earliest), 1);
      r.pending.splice(r.pending.indexOf(earliest), 1);
      if (confirm && !m.down) {
        r.down(earliest);
        modelPress(m, 'down');
      }
      checkTimers(m, r, 'PendingEnd');
    },
    toString: () => `PendingEnd(${confirm ? 'confirmed' : 'discarded'})`,
  })),
  fc.integer({ min: 0, max: 700 }).map<TimerCommand>((ms) => ({
    check: () => true,
    run(m, r) {
      m.now += ms;
      r.clock.advance(ms);
      checkTimers(m, r, 'Advance');
    },
    toString: () => `Advance(${ms})`,
  })),
  fc.constant<TimerCommand>({
    check: () => true,
    run(m, r) {
      r.scheduler.runDue(r.clock.now());
      r.ui.runDue(r.clock.now());
      while (m.timer !== null && m.timer.due <= m.now) {
        const { deadline } = m.timer;
        const pending = minPending(m);
        if (pending !== null && pending < deadline) {
          // Pending-press guard: no tick, retry 50 ms later for the same deadline.
          m.timer = { due: m.now + PENDING_RETRY_MS, deadline };
          continue;
        }
        const t = pending === null ? m.now : Math.min(m.now, pending);
        m.ticks.push(t);
        if (m.engineDeadline !== null && t >= m.engineDeadline) m.engineDeadline = null;
        modelEngineCall(m);
        modelReschedule(m);
      }
      checkTimers(m, r, 'RunDue');
    },
    toString: () => 'RunDue',
  }),
  eventListArb(nonAlarmEventArb).map<TimerCommand>((events) => ({
    check: () => true,
    run(m, r) {
      m.script.push([...events]);
      r.script(...events);
      checkTimers(m, r, 'EngineReturns');
    },
    toString: () => `EngineReturns(${JSON.stringify(events)})`,
  })),
  fc.option(fc.integer({ min: -200, max: 800 }), { nil: null }).map<TimerCommand>((offset) => ({
    check: () => true,
    run(m, r) {
      const deadline = offset === null ? null : m.now + offset;
      m.engineDeadline = deadline;
      r.engine().deadline = deadline;
      // Takes effect at the next Engine call, reset or replacement.
    },
    toString: () => `SetDeadline(${offset === null ? 'null' : `now${offset >= 0 ? '+' : ''}${offset}`})`,
  })),
  fc.constant<TimerCommand>({
    check: () => true,
    run(m, r) {
      r.controller.setInitialEstimates(null);
      m.engineDeadline = null;
      if (m.engineHeld) m.withholdUp = true;
      m.engineHeld = false;
      modelReschedule(m);
      checkTimers(m, r, 'ReplaceEngine');
    },
    toString: () => 'ReplaceEngine',
  }),
];

// ---------------------------------------------------------------------------------------------
// Property 20: press routing and the alarm

interface AlarmModel {
  down: boolean;
  engineHeld: boolean;
  withholdUp: boolean;
  alarmActive: boolean;
  alarmThrows: boolean;
  script: EngineEvent[][];
  /** Expected press, release and reset calls on the Engine. */
  engineCalls: EngineCall[];
  alarmPresses: PressEvent[];
  starts: number;
}

function alarmModelEvents(m: AlarmModel): void {
  for (const event of m.script.shift() ?? []) {
    if (isSos(event)) {
      m.starts += 1;
      if (!m.alarmThrows) m.alarmActive = true;
      m.engineCalls.push({ kind: 'reset' });
      if (m.engineHeld) m.withholdUp = true;
      m.engineHeld = false;
    } else if (isSpeak(event)) {
      m.engineCalls.push({ kind: 'reset' });
    }
  }
}

function alarmModelPress(m: AlarmModel, event: PressEvent): void {
  m.down = event.kind === 'down';
  if (event.kind === 'down') m.withholdUp = false;
  if (event.kind === 'up' && m.withholdUp) {
    m.withholdUp = false;
    return;
  }
  if (m.alarmActive) {
    m.alarmPresses.push(event);
    return;
  }
  m.engineCalls.push({ kind: event.kind === 'down' ? 'press' : 'release', t: event.t });
  m.engineHeld = event.kind === 'down';
  alarmModelEvents(m);
}

function checkRouting(m: AlarmModel, r: ControllerRig, label: string): void {
  const calls = r.engine().calls.filter((call) => call.kind !== 'tick');
  expect(calls, `${label}: Engine calls`).toEqual(m.engineCalls);
  expect(r.alarm.presses, `${label}: alarm presses`).toEqual(m.alarmPresses);
  expect(r.alarm.starts, `${label}: alarm starts`).toBe(m.starts);
  expect(r.alarm.isActive(), `${label}: alarm active`).toBe(m.alarmActive);
  if (m.alarmActive) expect(r.scheduler.pending(), `${label}: Tick_Timer while the alarm is active`).toBe(0);
}

type AlarmCommand = fc.Command<AlarmModel, ControllerRig>;

const alarmEventArb: fc.Arbitrary<EngineEvent> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<EngineEvent>({ type: 'command', command: 'sos' }) },
  { weight: 4, arbitrary: nonAlarmEventArb },
);

const alarmCommands: fc.Arbitrary<AlarmCommand>[] = [
  fc.integer({ min: 0, max: 400 }).map<AlarmCommand>((dt) => ({
    check: (m) => !m.down,
    run(m, r) {
      r.clock.advance(dt);
      const startsBefore = r.alarm.starts;
      const event = r.down();
      alarmModelPress(m, event);
      checkRouting(m, r, 'Down');
      if (r.alarm.starts > startsBefore) expect(r.scheduler.pending(), 'Tick_Timer after the alarm started').toBe(0);
    },
    toString: () => `Down(+${dt})`,
  })),
  fc.integer({ min: 0, max: 400 }).map<AlarmCommand>((dt) => ({
    check: (m) => m.down,
    run(m, r) {
      r.clock.advance(dt);
      const startsBefore = r.alarm.starts;
      const event = r.up();
      alarmModelPress(m, event);
      checkRouting(m, r, 'Up');
      if (r.alarm.starts > startsBefore) expect(r.scheduler.pending(), 'Tick_Timer after the alarm started').toBe(0);
    },
    toString: () => `Up(+${dt})`,
  })),
  eventListArb(alarmEventArb).map<AlarmCommand>((events) => ({
    check: () => true,
    run(m, r) {
      m.script.push([...events]);
      r.script(...events);
    },
    toString: () => `EngineReturns(${JSON.stringify(events)})`,
  })),
  fc.integer({ min: 50, max: 600 }).map<AlarmCommand>((offset) => ({
    check: () => true,
    run(m, r) {
      // A deadline the next Engine call leaves in place, so a Tick_Timer can be pending at alarm time.
      r.engine().deadline = r.clock.now() + offset;
    },
    toString: () => `SetDeadline(now+${offset})`,
  })),
  fc.constant<AlarmCommand>({
    check: (m) => m.alarmActive,
    run(m, r) {
      r.alarm.setActive(false);
      m.alarmActive = false;
      checkRouting(m, r, 'AlarmEnd');
    },
    toString: () => 'AlarmEnd',
  }),
  fc.boolean().map<AlarmCommand>((throws) => ({
    check: () => true,
    run(m, r) {
      r.alarm.throwOnStart = throws;
      m.alarmThrows = throws;
    },
    toString: () => `AlarmThrows(${throws})`,
  })),
  fc.array(arbSuggestionText(), { maxLength: 3 }).map<AlarmCommand>((suggestions) => ({
    check: () => true,
    run(m, r) {
      // Resolves the newest pending Client request; most stay unresolved.
      const text = trimmedText(r.controller.getSnapshot().session);
      r.client.deliver({ text, suggestions, source: 'ai' });
      checkRouting(m, r, 'Deliver');
    },
    toString: () => `Deliver(${suggestions.length})`,
  })),
];

// ---------------------------------------------------------------------------------------------
// Property 21: Client calls follow Trimmed_Text and partner Turns

type ClientOp =
  | { readonly kind: 'engine'; readonly event: EngineEvent }
  | {
      readonly kind: 'deliver';
      readonly fresh: boolean;
      readonly miss: NearMiss;
      readonly suggestions: readonly string[];
      readonly source: 'ai' | 'on-device';
    }
  | { readonly kind: 'line'; readonly text: string }
  | { readonly kind: 'pick'; readonly index: number }
  | { readonly kind: 'clear' };

const clientOpArb: fc.Arbitrary<ClientOp> = fc.oneof(
  { weight: 12, arbitrary: nonAlarmEventArb.map((event): ClientOp => ({ kind: 'engine', event })) },
  {
    weight: 3,
    arbitrary: fc
      .record({
        fresh: fc.integer({ min: 1, max: 10 }).map((n) => n <= 7),
        miss: fc.constantFrom<NearMiss>('case', 'inner', 'outer'),
        suggestions: fc.array(arbSuggestionText(), { maxLength: 4 }),
        source: sourceArb,
      })
      .map((op): ClientOp => ({ kind: 'deliver', ...op })),
  },
  { weight: 3, arbitrary: partnerLineTextArb.map((text): ClientOp => ({ kind: 'line', text })) },
  { weight: 2, arbitrary: pickIndexArb.map((index): ClientOp => ({ kind: 'pick', index })) },
  { weight: 1, arbitrary: fc.constant<ClientOp>({ kind: 'clear' }) },
);

function applyClientOp(r: ControllerRig, op: ClientOp): void {
  switch (op.kind) {
    case 'engine':
      r.script(op.event);
      r.clock.advance(5);
      r.down();
      r.clock.advance(5);
      r.up();
      return;
    case 'deliver': {
      const current = trimmedText(r.controller.getSnapshot().session);
      const text = op.fresh ? current : nearMiss(current, op.miss);
      r.client.deliver({ text, suggestions: op.suggestions, source: op.source });
      return;
    }
    case 'line':
      r.controller.partnerLine(op.text);
      return;
    case 'pick':
      r.controller.partnerPick(op.index);
      return;
    case 'clear':
      r.controller.clearHistory();
      return;
  }
}

function expectedCalls(before: SessionState, after: SessionState): { text: string; context: unknown }[] {
  const was = trimmedText(before);
  const now = trimmedText(after);
  const last = after.turns.at(-1);
  const partnerAppended = last !== undefined && last.id !== before.turns.at(-1)?.id && last.role === 'partner';
  if (now !== was || (partnerAppended && now !== '')) {
    return [{ text: now, context: contextWindow(after.turns).map((turn) => ({ role: turn.role, text: turn.text })) }];
  }
  return [];
}

describe('SessionController properties', () => {
  // Feature: conversation-ui, Property 19: One Tick_Timer, never ticking past a pending press
  it('P19 one tick timer, never ticking past a pending press', () => {
    fc.assert(
      fc.property(fc.commands(timerCommands, { maxCommands: 80, size: 'max' }), (commands) => {
        const setup = () => {
          const real = createControllerRig({ start: 1_000 });
          const model: TimerModel = {
            now: real.clock.now(),
            pending: [],
            down: false,
            engineHeld: false,
            withholdUp: false,
            engineDeadline: null,
            timer: null,
            script: [],
            ticks: [],
          };
          return { model, real };
        };
        fc.modelRun(setup, commands);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 20: Press routing and the alarm
  it('P20 press routing and the alarm', () => {
    fc.assert(
      fc.property(fc.commands(alarmCommands, { maxCommands: 80, size: 'max' }), (commands) => {
        const setup = () => {
          const real = createControllerRig();
          const model: AlarmModel = {
            down: false,
            engineHeld: false,
            withholdUp: false,
            alarmActive: false,
            alarmThrows: false,
            script: [],
            engineCalls: [],
            alarmPresses: [],
            starts: 0,
          };
          return { model, real };
        };
        fc.modelRun(setup, commands);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 21: Client calls follow Trimmed_Text and partner Turns
  it('P21 client calls follow trimmed text and partner turns', () => {
    const storedHistory = fc.oneof(
      fc.constant(null),
      arbHistoryRecord().map((record) => ({ ...record, turns: record.turns.slice(0, 25) })),
    );
    fc.assert(
      fc.property(storedHistory, fc.array(clientOpArb, { maxLength: 120, size: 'max' }), (history, ops) => {
        const backend = memoryBackend(history === null ? {} : { [HISTORY_KEY]: JSON.stringify(history) });
        const r = createControllerRig({ backend });
        expect(r.client.updates).toEqual([]);
        for (const op of ops) {
          const before = r.controller.getSnapshot().session;
          const seen = r.client.updates.length;
          applyClientOp(r, op);
          const after = r.controller.getSnapshot().session;
          expect(r.client.updates.slice(seen), JSON.stringify(op)).toEqual(expectedCalls(before, after));
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
