/**
 * fast-check arbitraries and helpers for the safety tests (design "Testing Strategy",
 * "Generators"). Test-only: never re-exported from index.ts.
 */
import fc from 'fast-check';
import {
  SOURCE_KINDS,
  createManualScheduler,
  pressEvent,
  type ManualScheduler,
  type PressEvent,
  type PressKind,
  type Scheduler,
  type SourceKind,
} from '@/lib/input';
import { alarmStep, type AlarmInput, type AlarmState, type AlarmStepResult } from './alarm-machine';
import type { RouteContext } from './press-router';

/** Minimum fast-check runs for every safety property. */
export const PROP_RUNS = 200;
/** Runs for the router properties (tasks 5.5, 5.6 and 13.5). */
export const PROP_RUNS_HEAVY = 500;

/** Freezes a value and everything reachable from it, so a test can prove nothing is mutated. */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  Object.freeze(value);
  return value;
}

// ---------------------------------------------------------------------------
// Alarm_Machine (task 3.3)

export const ALARM_INPUTS: readonly AlarmInput[] = Object.freeze(['start', 'down', 'up', 'partner-dismiss']);

const alarmInputArb: fc.Arbitrary<AlarmInput> = fc.constantFrom(...ALARM_INPUTS);

/** A `start` followed by a burst of presses, so many generated runs complete an Alarm_Episode. */
const alarmBurstArb: fc.Arbitrary<readonly AlarmInput[]> = fc
  .array(fc.constantFrom<AlarmInput>('down', 'up', 'down', 'up', 'partner-dismiss', 'start'), { maxLength: 6 })
  .map((burst) => ['start', ...burst]);

/** 0 to `max` Alarm_Machine inputs, weighted toward `start` followed by down/up bursts. */
export function arbAlarmInputs(opts: { readonly max: number } = { max: 200 }): fc.Arbitrary<readonly AlarmInput[]> {
  return fc
    .array(
      fc.oneof(
        { weight: 3, arbitrary: alarmBurstArb },
        { weight: 2, arbitrary: alarmInputArb.map((input): readonly AlarmInput[] => [input]) },
      ),
      { maxLength: Math.ceil(opts.max / 3), size: 'max' },
    )
    .map((chunks) => chunks.flat().slice(0, opts.max));
}

export interface AlarmStepRecord {
  readonly before: AlarmState;
  readonly input: AlarmInput;
  readonly result: AlarmStepResult;
}

/** Folds the inputs through alarmStep from `from` (default idle) and returns every step. */
export function foldAlarm(inputs: readonly AlarmInput[], from: AlarmState = 'idle'): readonly AlarmStepRecord[] {
  const steps: AlarmStepRecord[] = [];
  let state = from;
  for (const input of inputs) {
    const result = alarmStep(state, input);
    steps.push({ before: state, input, result });
    state = result.state;
  }
  return steps;
}

export interface AlarmEpisode {
  readonly steps: readonly AlarmStepRecord[];
  /** True when the episode returned to idle before the sequence ended. */
  readonly complete: boolean;
}

/** Alarm_Episodes: from a step that leaves idle up to and including the next step that returns to idle. */
export function splitEpisodes(steps: readonly AlarmStepRecord[]): readonly AlarmEpisode[] {
  const episodes: AlarmEpisode[] = [];
  let current: AlarmStepRecord[] | null = null;
  for (const step of steps) {
    if (current === null) {
      if (step.before === 'idle' && step.result.state !== 'idle') current = [step];
      continue;
    }
    current.push(step);
    if (step.result.state === 'idle') {
      episodes.push({ steps: current, complete: true });
      current = null;
    }
  }
  if (current !== null) episodes.push({ steps: current, complete: false });
  return episodes;
}

// ---------------------------------------------------------------------------
// Chime_Schedule (task 4.2)

export interface ChimeInputs {
  readonly s: number;
  readonly from: number;
  readonly to: number;
  /** The stop time, or undefined for none. */
  readonly x: number | undefined;
}

const COORD = 1e9;
const MAX_WINDOW = 1e6;

const coordArb = fc.double({ min: -COORD, max: COORD, noNaN: true });
/** A point exactly on the grid s + k × 1000 (computed with the same expression as chimeSchedule). */
const gridArb = (s: number, kMin: number, kMax: number): fc.Arbitrary<number> =>
  fc.integer({ min: kMin, max: kMax }).map((k) => s + k * 1000);

/**
 * Valid Chime_Schedule inputs: finite doubles within ±1e9, windows of up to 10⁶ ms, biased so
 * that `from`, `to` and `x` often land exactly on s + k × 1000; `x` is optional.
 */
export function arbChimeInputs(
  opts: { readonly withStop?: 'always' | 'never' | 'maybe' } = {},
): fc.Arbitrary<ChimeInputs> {
  const withStop = opts.withStop ?? 'maybe';
  return coordArb
    .chain((s) => {
      const fromArb = fc.oneof(
        gridArb(s, -3, 1200),
        fc.double({ min: -2e6, max: 2e6, noNaN: true }).map((d) => s + d),
        coordArb,
      );
      return fromArb.chain((from) => {
        const firstK = Math.max(0, Math.ceil((from - s) / 1000));
        const toArb = fc.oneof(
          fc.double({ min: 1e-3, max: MAX_WINDOW, noNaN: true }).map((span) => from + span),
          fc.integer({ min: 0, max: 1000 }).map((k) => s + (firstK + k) * 1000),
        );
        const stopArb = fc.oneof(
          gridArb(s, firstK - 3, firstK + 1200),
          fc.double({ min: -1e6, max: 2e6, noNaN: true }).map((d) => from + d),
          coordArb,
        );
        const xArb: fc.Arbitrary<number | undefined> =
          withStop === 'never'
            ? fc.constant(undefined)
            : withStop === 'always'
              ? stopArb
              : fc.option(stopArb, { nil: undefined, freq: 2 });
        return fc.record({ s: fc.constant(s), from: fc.constant(from), to: toArb, x: xArb });
      });
    })
    .filter((inputs) => inputs.from < inputs.to && inputs.to - inputs.from <= MAX_WINDOW + 1000);
}

/** NaN and ±Infinity. */
export function arbBadNumber(): fc.Arbitrary<number> {
  return fc.constantFrom(Number.NaN, Infinity, -Infinity);
}

/**
 * The reference model of Requirement 5.2 and 5.3: every s + k × 1000 for integer k ≥ 0 with
 * from ≤ t < to (and t < x), found by walking k upward. The walk starts a few steps below the
 * first candidate so it does not iterate millions of times; the start is checked to be below `from`.
 */
export function referenceSchedule(s: number, from: number, to: number, x?: number): number[] {
  const times: number[] = [];
  let k = Math.max(0, Math.floor((from - s) / 1000) - 3);
  if (k > 0 && s + (k - 1) * 1000 >= from) throw new Error('referenceSchedule started too high');
  for (; s + k * 1000 < to; k += 1) {
    const t = s + k * 1000;
    if (t >= from && (x === undefined || t < x)) times.push(t);
  }
  return times;
}

// ---------------------------------------------------------------------------
// Press_Router (task 5.4)

export const sourceKindArb: fc.Arbitrary<SourceKind> = fc.constantFrom(...SOURCE_KINDS);

/**
 * 0 to `max` Press_Events with non-decreasing timestamps and random Source_Kinds. `alternating`
 * gives down/up/down/… (starting with either kind), `arbitrary` any order, `mixed` either.
 */
export function arbPressEvents(
  opts: { readonly max?: number; readonly order?: 'alternating' | 'arbitrary' | 'mixed' } = {},
): fc.Arbitrary<readonly PressEvent[]> {
  const max = opts.max ?? 200;
  const order = opts.order ?? 'mixed';
  const alternating = order === 'alternating' ? fc.constant(true) : order === 'arbitrary' ? fc.constant(false) : fc.boolean();
  return fc
    .record({
      alternating,
      startWithUp: fc.boolean(),
      start: fc.integer({ min: 0, max: 1_000_000 }),
      steps: fc.array(
        fc.record({
          dt: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 3_000 })),
          kind: fc.constantFrom<PressKind>('down', 'up'),
          source: sourceKindArb,
        }),
        { maxLength: max, size: 'max' },
      ),
    })
    .map(({ alternating: alt, startWithUp, start, steps }) => {
      let t = start;
      return steps.map((step, i) => {
        t += step.dt;
        const kind: PressKind = alt ? ((i % 2 === 0) !== startWithUp ? 'down' : 'up') : step.kind;
        return pressEvent(kind, t, step.source);
      });
    });
}

const routeContextArb: fc.Arbitrary<RouteContext> = fc.record({
  alarmActive: fc.boolean(),
  onboardingOpen: fc.boolean(),
});

/** `count` Route_Contexts, one per Press_Event; runs of equal flags are common, like real modes. */
export function arbRouteContexts(count: number): fc.Arbitrary<readonly RouteContext[]> {
  return fc
    .array(fc.tuple(routeContextArb, fc.integer({ min: 1, max: 8 })), { minLength: 1, maxLength: Math.max(1, count) })
    .map((runs) => runs.flatMap(([ctx, n]) => Array.from({ length: n }, () => ctx)))
    .chain((flat) =>
      flat.length >= count
        ? fc.constant(flat.slice(0, count))
        : fc
            .array(routeContextArb, { minLength: count - flat.length, maxLength: count - flat.length })
            .map((rest) => [...flat, ...rest]),
    );
}

// ---------------------------------------------------------------------------
// Chime_Player (task 12.4)

export type ChimePlayerCommand =
  /** Moves both clocks by `ms`; timers fire up to `lateness` ms after they are due. */
  | { readonly kind: 'advance'; readonly ms: number; readonly lateness: number }
  | { readonly kind: 'hide' }
  | { readonly kind: 'show' }
  | { readonly kind: 'start' }
  | { readonly kind: 'stop' };

/** 0 to 100 commands: advances of up to 120 000 ms with late timer firing of 0 to 120 000 ms, hide, show, start, stop. */
export function arbChimePlayerCommands(opts: { readonly max?: number } = {}): fc.Arbitrary<readonly ChimePlayerCommand[]> {
  const advance: fc.Arbitrary<ChimePlayerCommand> = fc.record({
    kind: fc.constant('advance' as const),
    ms: fc.oneof({ weight: 4, arbitrary: fc.integer({ min: 0, max: 3_000 }) }, { weight: 1, arbitrary: fc.integer({ min: 0, max: 120_000 }) }),
    lateness: fc.oneof(fc.constant(0), fc.integer({ min: 0, max: 1_000 }), fc.integer({ min: 0, max: 120_000 })),
  });
  return fc.array(
    fc.oneof(
      { weight: 8, arbitrary: advance },
      { weight: 1, arbitrary: fc.constant<ChimePlayerCommand>({ kind: 'hide' }) },
      { weight: 1, arbitrary: fc.constant<ChimePlayerCommand>({ kind: 'show' }) },
      { weight: 1, arbitrary: fc.constant<ChimePlayerCommand>({ kind: 'start' }) },
      { weight: 1, arbitrary: fc.constant<ChimePlayerCommand>({ kind: 'stop' }) },
    ),
    { maxLength: opts.max ?? 100, size: 'max' },
  );
}

/** A ManualScheduler that also reports when its earliest live timer is due, so a test can fire it late. */
export function createLateScheduler(clock: () => number): {
  readonly scheduler: Scheduler;
  readonly manual: ManualScheduler;
  nextDue(): number | null;
} {
  const manual = createManualScheduler(clock);
  const dues = new Map<number, number>();
  let nextId = 0;
  return {
    manual,
    scheduler: {
      schedule(delayMs, fn) {
        const id = nextId++;
        dues.set(id, clock() + (Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0));
        const cancel = manual.schedule(delayMs, () => {
          dues.delete(id);
          fn();
        });
        return () => {
          dues.delete(id);
          cancel();
        };
      },
    },
    nextDue: () => (dues.size === 0 ? null : Math.min(...dues.values())),
  };
}

// ---------------------------------------------------------------------------
// Router commands (task 13.4)

export type RouterCommand =
  | { readonly kind: 'press'; readonly event: PressEvent }
  | { readonly kind: 'start' }
  | { readonly kind: 'partner-dismiss' }
  | { readonly kind: 'onboarding-open' }
  | { readonly kind: 'onboarding-close' };

/**
 * 0 to `max` commands (default 200): Press_Events from any Source_Kind in Output_Stream order
 * (alternating down/up, non-decreasing t) mixed with alarm starts, partner dismissals and
 * onboarding opens and closes.
 */
export function arbRouterCommands(opts: { readonly max?: number } = {}): fc.Arbitrary<readonly RouterCommand[]> {
  type Slot = RouterCommand['kind'];
  const slotArb: fc.Arbitrary<Slot> = fc.oneof(
    { weight: 8, arbitrary: fc.constant<Slot>('press') },
    { weight: 2, arbitrary: fc.constant<Slot>('start') },
    { weight: 1, arbitrary: fc.constant<Slot>('partner-dismiss') },
    { weight: 1, arbitrary: fc.constant<Slot>('onboarding-open') },
    { weight: 1, arbitrary: fc.constant<Slot>('onboarding-close') },
  );
  return fc
    .record({
      startWithUp: fc.boolean(),
      slots: fc.array(
        fc.record({ slot: slotArb, dt: fc.integer({ min: 0, max: 2_000 }), source: sourceKindArb }),
        { maxLength: opts.max ?? 200, size: 'max' },
      ),
    })
    .map(({ startWithUp, slots }) => {
      let t = 0;
      let next: PressKind = startWithUp ? 'up' : 'down';
      return slots.map(({ slot, dt, source }): RouterCommand => {
        if (slot !== 'press') return { kind: slot };
        t += dt;
        const kind = next;
        next = kind === 'down' ? 'up' : 'down';
        return { kind: 'press', event: pressEvent(kind, t, source) };
      });
    });
}

/** Press_Events, each paired with the flags that hold when it arrives. */
export function arbRoutedPresses(
  opts: { readonly max?: number; readonly order?: 'alternating' | 'arbitrary' | 'mixed' } = {},
): fc.Arbitrary<readonly { readonly event: PressEvent; readonly ctx: RouteContext }[]> {
  return arbPressEvents(opts).chain((events) =>
    arbRouteContexts(events.length).map((contexts) =>
      events.map((event, i) => ({ event, ctx: contexts[i] ?? { alarmActive: false, onboardingOpen: false } })),
    ),
  );
}
