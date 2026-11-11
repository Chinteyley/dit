/**
 * fast-check arbitraries, reference models, fakes and script runners shared by the input tests.
 * Imported only by test files; never re-exported from index.ts.
 */
import fc from 'fast-check';
import { INITIAL_ARBITER_STATE, arbiterStep, type ArbiterInput, type ArbiterState } from './arbiter';
import { createBlinkDetector, type BlinkDetector, type DetectorConfig, type RawBlinkFrame } from './blink/detector';
import type { BlinkDevices, CameraStream, CameraTrack, Landmarker } from './blink/source';
import { createManualClock, createManualScheduler, type ManualClock, type ManualScheduler } from './clock';
import { MIN_PRESS_RANGES, createDebouncer, type Debouncer } from './debounce';
import type { FocusClass } from './focus';
import { createKeyRouter, type KeyEventLike, type KeyEventTarget, type KeyRouter } from './key-router';
import { createKeyboardSource, type KeySource } from './keyboard';
import {
  createPointerSource,
  type DocumentPointerTarget,
  type PointerEventLike,
  type PointerSource,
  type SurfaceElement,
  type SurfaceEventType,
} from './pointer';
import type { SettingsStore, StoreError } from './settings';
import type { PageLifecycle } from './source-base';
import { createSwitchSource, type SwitchSource } from './switch';
import { createSwitchLearner, type SwitchLearner } from './switch-learner';
import {
  SOURCE_KINDS,
  pressEvent,
  type PressEvent,
  type PressKind,
  type PressSource,
  type Result,
  type SourceKind,
  type SourceStatus,
  type Unsubscribe,
} from './types';

/** Minimum fast-check runs for every input-sources property. */
export const PROP_RUNS = 200;

// ---------------------------------------------------------------------------
// Base arbitraries and helpers

export const sourceKindArb: fc.Arbitrary<SourceKind> = fc.constantFrom(...SOURCE_KINDS);
export const pressKindArb: fc.Arbitrary<PressKind> = fc.constantFrom('down', 'up');
export const nonFiniteArb: fc.Arbitrary<number> = fc.constantFrom(Number.NaN, Infinity, -Infinity);

/** Absolute timestamps from signed integer steps: a running clock starting at `start`. */
export function runningTimes(steps: readonly number[], start = 0): number[] {
  const times: number[] = [];
  let t = start;
  for (const step of steps) {
    t += step;
    times.push(t);
  }
  return times;
}

/**
 * Integer timestamp scripts: a running clock advanced by signed integer steps from [min, max].
 * Negative steps make later timestamps smaller than earlier ones (stale input).
 */
export function timestampScriptArb(options: {
  readonly minStep: number;
  readonly maxStep: number;
  readonly maxLength?: number;
  readonly start?: number;
}): fc.Arbitrary<readonly number[]> {
  return fc
    .array(fc.integer({ min: options.minStep, max: options.maxStep }), {
      maxLength: options.maxLength ?? 100,
      size: 'max',
    })
    .map((steps) => runningTimes(steps, options.start ?? 0));
}

/** `null` 19 times in 20, otherwise NaN or ±Infinity: mixes non-finite timestamps into a script. */
export const badTimeOrNullArb: fc.Arbitrary<number | null> = fc.oneof(
  { weight: 19, arbitrary: fc.constant(null) },
  { weight: 1, arbitrary: nonFiniteArb },
);

/**
 * Press_Event scripts with running integer timestamps (steps in [-50, 300]) and about 5% NaN or
 * ±Infinity timestamps, any source and any kind.
 */
export const pressEventScriptArb: fc.Arbitrary<readonly PressEvent[]> = fc
  .array(
    fc.record({
      source: sourceKindArb,
      kind: pressKindArb,
      step: fc.integer({ min: -50, max: 300 }),
      bad: badTimeOrNullArb,
    }),
    { maxLength: 200, size: 'max' },
  )
  .map((draws) => {
    let t = 0;
    return draws.map(({ source, kind, step, bad }) => {
      t += step;
      return pressEvent(kind, bad ?? t, source);
    });
  });

/** Collects every value a subscription delivers. */
export interface Collector<T> {
  readonly values: T[];
  readonly listener: (value: T) => void;
}

export function collect<T>(): Collector<T> {
  const values: T[] = [];
  return { values, listener: (value) => values.push(value) };
}

/** True when the events alternate down, up, down… starting with down. */
export function alternates(events: readonly PressEvent[]): boolean {
  return events.every((event, i) => event.kind === (i % 2 === 0 ? 'down' : 'up'));
}

/** True when every t is finite and no t is below the previous one. */
export function nonDecreasing(events: readonly PressEvent[]): boolean {
  return events.every((event, i) => Number.isFinite(event.t) && (i === 0 || event.t >= (events[i - 1]?.t ?? -Infinity)));
}

/** Plain copies of events, for comparisons that should ignore object identity. */
export function plain(events: readonly PressEvent[]): readonly { kind: PressKind; t: number; source: SourceKind }[] {
  return events.map(({ kind, t, source }) => ({ kind, t, source }));
}

// ---------------------------------------------------------------------------
// Debouncer (Properties 5 to 7)

export type DebounceOp =
  | { readonly type: 'rawDown'; readonly t: number }
  | { readonly type: 'rawUp'; readonly t: number }
  | { readonly type: 'advance'; readonly now: number }
  | { readonly type: 'setMin'; readonly value: number };

export function applyDebounceOp(debouncer: Debouncer, op: DebounceOp): readonly PressEvent[] {
  switch (op.type) {
    case 'rawDown':
      return debouncer.rawDown(op.t);
    case 'rawUp':
      return debouncer.rawUp(op.t);
    case 'advance':
      return debouncer.advance(op.now);
    case 'setMin':
      debouncer.setMinPressDuration(op.value);
      return [];
  }
}

export interface DebounceModelRun {
  /** The events of each op. */
  readonly perOp: readonly (readonly PressEvent[])[];
  /**
   * Indices, in the flattened output, of `up` events whose Raw_Up is earlier than the advance that
   * confirmed the press. Only scripts whose time runs backwards produce them; their pair can be
   * shorter than min, because the confirming `down` was already emitted (transition table rows
   * "pending + advance" and "confirmed + rawUp").
   */
  readonly staleUps: ReadonlySet<number>;
}

/**
 * Reference model of one Debouncer, written from the requirements rather than the transition table:
 * the first Raw_Down while idle starts a press with the setting in effect at that moment; the press
 * is confirmed once an advance reaches Raw_Down + min (at once when min is 0); the next Raw_Up,
 * clamped to the Raw_Down time, ends it and keeps it when it lasted at least min. Inputs with a
 * non-finite time are ignored.
 */
export function debounceModel(kind: SourceKind, initialMin: number, ops: readonly DebounceOp[]): DebounceModelRun {
  let min = initialMin;
  let press: { downT: number; min: number; confirmedAt: number | null } | null = null;
  let emitted = 0;
  const staleUps = new Set<number>();
  const perOp = ops.map((op): readonly PressEvent[] => {
    const out = ((): readonly PressEvent[] => {
      if (op.type === 'setMin') {
        min = op.value;
        return [];
      }
      const t = op.type === 'advance' ? op.now : op.t;
      if (!Number.isFinite(t)) return [];
      switch (op.type) {
        case 'rawDown':
          if (press !== null) return [];
          press = { downT: t, min, confirmedAt: min === 0 ? t : null };
          return press.confirmedAt === null ? [] : [pressEvent('down', t, kind)];
        case 'advance':
          if (press === null || press.confirmedAt !== null || t - press.downT < press.min) return [];
          press.confirmedAt = t;
          return [pressEvent('down', press.downT, kind)];
        case 'rawUp': {
          if (press === null) return [];
          const { downT, min: pressMin, confirmedAt } = press;
          press = null;
          const upT = Math.max(t, downT);
          if (confirmedAt !== null) {
            if (t < confirmedAt) staleUps.add(emitted);
            return [pressEvent('up', upT, kind)];
          }
          return upT - downT >= pressMin ? [pressEvent('down', downT, kind), pressEvent('up', upT, kind)] : [];
        }
      }
    })();
    emitted += out.length;
    return out;
  });
  return { perOp, staleUps };
}

/** Valid Min_Press_Duration values for a kind: integers in range, with the range ends weighted in. */
export function validMinArb(kind: SourceKind): fc.Arbitrary<number> {
  const { min, max } = MIN_PRESS_RANGES[kind];
  return fc.oneof(
    { weight: 5, arbitrary: fc.integer({ min, max }) },
    { weight: 2, arbitrary: fc.constantFrom(min, max) },
    { weight: 1, arbitrary: fc.integer({ min, max: Math.min(max, min + 60) }) },
  );
}

/**
 * rawDown / rawUp / advance scripts on a running integer clock with steps in [-100, 800], so
 * timestamps repeat and go backwards; about 1 in 30 times is NaN or ±Infinity. About 1 op in 4
 * lands exactly on, or 1 ms before, the last rawDown time plus one of `durations` (the settings
 * under test), so the `t >= downT + min` boundary is hit often.
 */
export function debounceOpsArb(durations: readonly number[] = []): fc.Arbitrary<readonly DebounceOp[]> {
  const offsetArb: fc.Arbitrary<number | null> =
    durations.length === 0
      ? fc.constant(null)
      : fc.oneof(
          { weight: 3, arbitrary: fc.constant(null) },
          { weight: 1, arbitrary: fc.tuple(fc.constantFrom(...durations), fc.constantFrom(0, -1)).map(([d, e]) => d + e) },
        );
  return fc
    .array(
      fc.record({
        type: fc.constantFrom('rawDown', 'rawUp', 'advance'),
        dt: fc.integer({ min: -100, max: 800 }),
        offset: offsetArb,
        bad: fc.oneof({ weight: 29, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: nonFiniteArb }),
      }),
      { maxLength: 120, size: 'max' },
    )
    .map((draws) => {
      let clock = 0;
      let lastDown = 0;
      return draws.map(({ type, dt, offset, bad }): DebounceOp => {
        clock = offset === null || type === 'rawDown' ? clock + dt : lastDown + offset;
        const t = bad ?? clock;
        if (type === 'rawDown' && bad === null) lastDown = t;
        return type === 'advance' ? { type, now: t } : { type, t };
      });
    });
}

/** Splits a debouncer's flat output into [down, up] pairs plus a trailing unmatched down, if any. */
export function pairsOf(events: readonly PressEvent[]): {
  readonly pairs: readonly (readonly [PressEvent, PressEvent])[];
  readonly open: PressEvent | null;
} {
  const pairs: [PressEvent, PressEvent][] = [];
  for (let i = 0; i + 1 < events.length; i += 2) {
    const down = events[i];
    const up = events[i + 1];
    if (down !== undefined && up !== undefined) pairs.push([down, up]);
  }
  return { pairs, open: events.length % 2 === 1 ? (events.at(-1) ?? null) : null };
}

// ---------------------------------------------------------------------------
// Input_Arbiter (Properties 1 to 4)

/**
 * Reference implementation of arbiter rules 1 to 9, written as a plain loop over mutable state.
 * Returns the Output_Stream for the whole input list and the final state.
 */
export function arbiterModel(inputs: readonly ArbiterInput[]): { readonly out: PressEvent[]; readonly state: ArbiterState } {
  let holder: SourceKind | null = null;
  let lastT: number | null = null;
  const marked = new Set<SourceKind>();
  const out: PressEvent[] = [];
  for (const input of inputs) {
    if (input.type === 'detach') {
      if (holder === input.source && lastT !== null) {
        const t: number = Number.isFinite(input.now) ? Math.max(input.now, lastT) : lastT;
        out.push(pressEvent('up', t, holder));
        holder = null;
        lastT = t;
      }
      marked.delete(input.source);
      continue;
    }
    const { kind, t, source } = input.event;
    if (!Number.isFinite(t)) continue;
    if (kind === 'down') {
      if (lastT !== null && t < lastT) continue;
      if (holder === null) {
        out.push(input.event);
        holder = source;
        lastT = t;
        marked.delete(source);
      } else if (holder !== source) {
        marked.add(source);
      }
      continue;
    }
    if (holder === source && lastT !== null) {
      const upT: number = Math.max(t, lastT);
      out.push(upT === t ? input.event : pressEvent('up', upT, source));
      holder = null;
      lastT = upT;
    } else if (marked.has(source)) {
      marked.delete(source);
    }
  }
  return { out, state: { holder, lastT, marks: SOURCE_KINDS.filter((kind) => marked.has(kind)) } };
}

const eventOrDetachDrawArb = fc.record({
  detach: fc.oneof({ weight: 9, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
  source: sourceKindArb,
  kind: pressKindArb,
  step: fc.integer({ min: -50, max: 300 }),
  bad: badTimeOrNullArb,
});

/** Random arbiter inputs: any source, any kind, running integer clock with steps in [-50, 300], 5% non-finite. */
export const randomArbiterInputsArb: fc.Arbitrary<readonly ArbiterInput[]> = fc
  .array(eventOrDetachDrawArb, { maxLength: 200, size: 'max' })
  .map((draws) => {
    let clock = 0;
    return draws.map(({ detach, source, kind, step, bad }): ArbiterInput => {
      clock += step;
      const t = bad ?? clock;
      return detach ? { type: 'detach', source, now: t } : { type: 'event', event: pressEvent(kind, t, source) };
    });
  });

/** A well-formed stream from one source: alternating down/up from `down`, non-decreasing t. */
export function wellFormedStreamArb(
  source: SourceKind,
  options: { readonly maxGap?: number; readonly maxLength?: number; readonly start?: number } = {},
): fc.Arbitrary<readonly PressEvent[]> {
  return fc
    .array(fc.nat({ max: options.maxGap ?? 400 }), { maxLength: options.maxLength ?? 40, size: 'max' })
    .map((gaps) => runningTimes(gaps, options.start ?? 0).map((t, i) => pressEvent(i % 2 === 0 ? 'down' : 'up', t, source)));
}

/**
 * 2 to 4 well-formed per-source streams interleaved in random order (half the time merged by
 * timestamp instead), with occasional detach inputs, so overlapping presses dominate.
 */
export const interleavedArbiterInputsArb: fc.Arbitrary<readonly ArbiterInput[]> = fc
  .shuffledSubarray([...SOURCE_KINDS], { minLength: 2, maxLength: 4 })
  .chain((kinds) =>
    fc.tuple(
      fc.tuple(...kinds.map((kind) => wellFormedStreamArb(kind))),
      fc.array(fc.nat({ max: kinds.length - 1 }), { maxLength: 200 }),
      fc.boolean(),
      fc.array(fc.record({ at: fc.nat(), source: fc.constantFrom(...kinds), delta: fc.integer({ min: -100, max: 100 }) }), {
        maxLength: 3,
      }),
    ),
  )
  .map(([streams, picks, byTime, detaches]) => {
    const cursors = streams.map(() => 0);
    const merged: PressEvent[] = [];
    let p = 0;
    const remaining = (): number[] => streams.flatMap((stream, i) => ((cursors[i] ?? 0) < stream.length ? [i] : []));
    for (let open = remaining(); open.length > 0; open = remaining()) {
      const choice = open[(picks[p++ % Math.max(picks.length, 1)] ?? 0) % open.length] ?? 0;
      const event = streams[choice]?.[cursors[choice] ?? 0];
      cursors[choice] = (cursors[choice] ?? 0) + 1;
      if (event !== undefined) merged.push(event);
    }
    if (byTime) merged.sort((a, b) => a.t - b.t);
    const inputs: ArbiterInput[] = merged.map((event) => ({ type: 'event', event }));
    for (const { at, source, delta } of detaches) {
      const index = inputs.length === 0 ? 0 : at % (inputs.length + 1);
      const before = inputs[index - 1];
      const now = before === undefined ? 0 : (before.type === 'event' ? before.event.t : before.now) + delta;
      inputs.splice(index, 0, { type: 'detach', source, now });
    }
    return inputs;
  });

/** Replays inputs through arbiterStep and returns the final state and the Output_Stream. */
export function runArbiter(inputs: readonly ArbiterInput[]): { readonly state: ArbiterState; readonly out: PressEvent[] } {
  let state = INITIAL_ARBITER_STATE;
  const out: PressEvent[] = [];
  for (const input of inputs) {
    const step = arbiterStep(state, input);
    state = step.state;
    if (step.out !== null) out.push(step.out);
  }
  return { state, out };
}

/** A PressSource whose events, statuses and pending value the test sets directly. */
export interface FakePressSource extends PressSource {
  emit(event: PressEvent): void;
  report(status: SourceStatus): void;
  setPending(since: number | null): void;
  listenerCount(): number;
}

export function createFakePressSource(kind: SourceKind): FakePressSource {
  const press = new Set<(event: PressEvent) => void>();
  const statusListeners = new Set<(status: SourceStatus) => void>();
  const pending = new Set<(since: number | null) => void>();
  let status: SourceStatus = 'off';
  let since: number | null = null;
  const add = <T>(set: Set<T>, listener: T): Unsubscribe => {
    set.add(listener);
    return () => {
      set.delete(listener);
    };
  };
  return {
    kind,
    start: () => undefined,
    stop: () => undefined,
    status: () => status,
    pendingSince: () => since,
    onPress: (listener) => add(press, listener),
    onStatus: (listener) => add(statusListeners, listener),
    onPending: (listener) => add(pending, listener),
    emit: (event) => [...press].forEach((listener) => listener(event)),
    report(next) {
      status = next;
      [...statusListeners].forEach((listener) => listener(next));
    },
    setPending(next) {
      since = next;
      [...pending].forEach((listener) => listener(next));
    },
    listenerCount: () => press.size + statusListeners.size + pending.size,
  };
}

// ---------------------------------------------------------------------------
// Keys (Properties 13 and 15)

/** A key event that records whether preventDefault was called. */
export interface FakeKeyEvent extends KeyEventLike {
  readonly prevented: boolean;
}

export function keyEvent(code: string, repeat = false): FakeKeyEvent {
  let prevented = false;
  return {
    code,
    repeat,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

/** Stands in for window keydown/keyup listeners; counts live listener pairs. */
export interface FakeKeyTarget extends KeyEventTarget {
  down(code: string, repeat?: boolean): FakeKeyEvent;
  up(code: string): FakeKeyEvent;
  listenerCount(): number;
}

export function createFakeKeyTarget(): FakeKeyTarget {
  const pairs = new Set<{ readonly onDown: (e: KeyEventLike) => void; readonly onUp: (e: KeyEventLike) => void }>();
  return {
    addKeyListeners(onDown, onUp) {
      const pair = { onDown, onUp };
      pairs.add(pair);
      return () => {
        pairs.delete(pair);
      };
    },
    down(code, repeat = false) {
      const event = keyEvent(code, repeat);
      [...pairs].forEach((pair) => pair.onDown(event));
      return event;
    },
    up(code) {
      const event = keyEvent(code);
      [...pairs].forEach((pair) => pair.onUp(event));
      return event;
    },
    listenerCount: () => pairs.size,
  };
}

export type KeyScriptEvent = {
  readonly type: 'down' | 'up';
  readonly code: string;
  readonly repeat: boolean;
  readonly focus: FocusClass;
};

export const RESERVED_CODES = ['Space', 'Enter', 'NumpadEnter', 'Tab', 'Escape'] as const;
export const focusClassArb: fc.Arbitrary<FocusClass> = fc.constantFrom('keying', 'editable', 'interactive');

/**
 * keydown/keyup scripts over the reserved codes, KeyA, `learned` and random codes, with random
 * repeat flags and focus classes. About half the keyups release one of the last 3 pressed codes,
 * so presses complete.
 */
export function keyScriptArb(learned: string, options: { readonly maxLength?: number } = {}): fc.Arbitrary<readonly KeyScriptEvent[]> {
  const codeArb = fc.oneof(
    { weight: 6, arbitrary: fc.constantFrom<string>(...RESERVED_CODES, 'KeyA', learned) },
    { weight: 1, arbitrary: fc.string({ maxLength: 6 }) },
  );
  return fc
    .array(
      fc.record({
        type: fc.constantFrom<'down' | 'up'>('down', 'up'),
        code: codeArb,
        recent: fc.option(fc.nat({ max: 2 }), { nil: null }),
        repeat: fc.oneof({ weight: 4, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
        focus: focusClassArb,
      }),
      { maxLength: options.maxLength ?? 80, size: 'max' },
    )
    .map((draws) => {
      const pressed: string[] = [];
      return draws.map(({ type, code, recent, repeat, focus }): KeyScriptEvent => {
        if (type === 'down') {
          pressed.push(code);
          return { type, code, repeat, focus };
        }
        const pick = recent === null ? undefined : pressed[pressed.length - 1 - recent];
        return { type, code: pick ?? code, repeat: false, focus };
      });
    });
}

// ---------------------------------------------------------------------------
// Blink_Detector (Properties 7 to 11)

export interface Thresholds {
  readonly close: number;
  readonly open: number;
}

/** Valid threshold pairs (0 < open < close ≤ 1), with the defaults weighted in. */
export const validThresholdsArb: fc.Arbitrary<Thresholds> = fc.oneof(
  { weight: 1, arbitrary: fc.constant({ close: 0.5, open: 0.35 }) },
  {
    weight: 4,
    arbitrary: fc
      .tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }))
      .filter(([close, open]) => open > 0 && open < close && close <= 1)
      .map(([close, open]) => ({ close, open })),
  },
);

/** Valid blink Min_Press_Duration values (50 to 2000 ms). */
export const blinkMinArb: fc.Arbitrary<number> = validMinArb('blink');

/**
 * Scores in three bands around the thresholds (below open, between, at or above close), weighted so
 * the between band is common, plus the exact threshold values and the ends of [0, 1].
 */
export function bandScoreArb(th: Thresholds): fc.Arbitrary<number> {
  return fc.oneof(
    { weight: 2, arbitrary: fc.double({ min: 0, max: th.open, maxExcluded: true, noNaN: true }) },
    { weight: 4, arbitrary: betweenScoreArb(th) },
    { weight: 2, arbitrary: fc.double({ min: th.close, max: 1, noNaN: true }) },
    { weight: 1, arbitrary: fc.constantFrom(th.open, th.close, 0, 1) },
  );
}

/** Scores at or above Open_Threshold and below Close_Threshold: never toggle Eye_State. */
export function betweenScoreArb(th: Thresholds): fc.Arbitrary<number> {
  return fc.oneof(
    fc.double({ min: th.open, max: th.close, maxExcluded: true, noNaN: true }),
    fc.constant(th.open),
  );
}

/**
 * Frame scripts: integer t steps in [-20, 120] (about 33 ms is a 30 fps frame, negative steps are
 * stale frames), per-eye band scores, `lostWeight` percent face-lost frames and about 1 in 30
 * non-finite timestamps.
 */
export function blinkFramesArb(
  th: Thresholds,
  options: { readonly lostWeight?: number; readonly maxLength?: number; readonly score?: fc.Arbitrary<number> } = {},
): fc.Arbitrary<readonly RawBlinkFrame[]> {
  const score = options.score ?? bandScoreArb(th);
  const lostWeight = options.lostWeight ?? 10;
  return fc
    .array(
      fc.record({
        step: fc.integer({ min: -20, max: 120 }),
        lost: fc.integer({ min: 0, max: 99 }).map((n) => n < lostWeight),
        left: score,
        right: score,
        bad: fc.oneof({ weight: 29, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: nonFiniteArb }),
      }),
      { maxLength: options.maxLength ?? 120, size: 'max' },
    )
    .map((draws) => {
      let clock = 0;
      return draws.map(({ step, lost, left, right, bad }): RawBlinkFrame => {
        clock += step;
        const t = bad ?? clock;
        return lost ? { t, face: 'lost' } : { t, left, right };
      });
    });
}

/** Runs of 1 to 6 consecutive face-lost or valid frames, `lostShare` (0 to 1) of the runs lost. */
export function faceRunFramesArb(th: Thresholds, lostShare: number): fc.Arbitrary<readonly RawBlinkFrame[]> {
  return fc
    .array(
      fc.record({
        lost: fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }).map((x) => x < lostShare),
        frames: fc.array(fc.record({ step: fc.integer({ min: -20, max: 120 }), left: bandScoreArb(th), right: bandScoreArb(th) }), {
          minLength: 1,
          maxLength: 6,
        }),
      }),
      { maxLength: 30, size: 'max' },
    )
    .map((runs) => {
      let clock = 0;
      return runs.flatMap(({ lost, frames }) =>
        frames.map(({ step, left, right }): RawBlinkFrame => {
          clock += step;
          return lost ? { t: clock, face: 'lost' } : { t: clock, left, right };
        }),
      );
    });
}

export type BlinkOp =
  | { readonly type: 'frame'; readonly frame: RawBlinkFrame }
  | { readonly type: 'setMin'; readonly value: number };

export interface ModelClosure {
  readonly start: number;
  /** t of the frame that ended it, or null when still open at the end of the script. */
  readonly end: number | null;
  /** Min_Press_Duration in effect at the Closure start. */
  readonly min: number;
  /** t of the last accepted frame during the Closure (the start frame included). */
  readonly lastT: number;
}

const isUnitScore = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;

/**
 * Reference hysteresis model: Closure starts and ends computed from the frames alone (stale and
 * non-finite frames skipped, bad scores treated as face lost).
 */
export function closuresFromFrames(ops: readonly BlinkOp[], th: Thresholds, initialMin: number): ModelClosure[] {
  const closures: ModelClosure[] = [];
  let lastT: number | null = null;
  let min = initialMin;
  let open: { start: number; min: number; lastT: number } | null = null;
  for (const op of ops) {
    if (op.type === 'setMin') {
      min = op.value;
      continue;
    }
    const { t, left, right, face } = op.frame;
    if (!Number.isFinite(t) || (lastT !== null && t < lastT)) continue;
    lastT = t;
    const valid = face !== 'lost' && isUnitScore(left) && isUnitScore(right);
    if (open !== null) {
      open.lastT = t;
      if (!valid || Math.max(left as number, right as number) < th.open) {
        closures.push({ start: open.start, end: t, min: open.min, lastT: t });
        open = null;
      }
    } else if (valid && Math.min(left, right) >= th.close) {
      open = { start: t, min, lastT: t };
    }
  }
  if (open !== null) closures.push({ start: open.start, end: null, min: open.min, lastT: open.lastT });
  return closures;
}

/** The Press_Events the closures should produce under the minimum-closure rule (Req 8.4 to 8.6). */
export function expectedBlinkEvents(closures: readonly ModelClosure[]): PressEvent[] {
  return closures.flatMap((c): PressEvent[] => {
    if (c.end !== null) {
      return c.end - c.start >= c.min ? [pressEvent('down', c.start, 'blink'), pressEvent('up', c.end, 'blink')] : [];
    }
    return c.lastT - c.start >= c.min ? [pressEvent('down', c.start, 'blink')] : [];
  });
}

/**
 * Scripts built from intended Closures (gap, length, end by opening or by losing the face), sampled
 * every 33 ms with ±5 ms jitter, with Min_Press_Duration changes between Closures and mid-Closure.
 */
export function intendedClosuresArb(th: Thresholds): fc.Arbitrary<readonly BlinkOp[]> {
  const unit = fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true });
  return fc
    .record({
      closures: fc.array(
        fc.record({
          gap: fc.integer({ min: 0, max: 600 }),
          len: fc.integer({ min: 0, max: 2500 }),
          endBy: fc.constantFrom<'open' | 'lost'>('open', 'lost'),
          minChange: fc.option(blinkMinArb, { nil: null }),
          changeMid: fc.boolean(),
        }),
        { maxLength: 10, size: 'max' },
      ),
      jitter: fc.array(fc.integer({ min: -5, max: 5 }), { minLength: 1, maxLength: 16 }),
      openUnits: fc.array(unit, { minLength: 1, maxLength: 8 }),
      closedUnits: fc.array(unit, { minLength: 1, maxLength: 8 }),
    })
    .map(({ closures, jitter, openUnits, closedUnits }) => {
      const ops: BlinkOp[] = [];
      let t = 0;
      let j = 0;
      let o = 0;
      let c = 0;
      const step = (): number => 33 + (jitter[j++ % jitter.length] ?? 0);
      const openScore = (): number => (openUnits[o++ % openUnits.length] ?? 0) * th.open;
      const closedScore = (): number => Math.min(1, th.close + (closedUnits[c++ % closedUnits.length] ?? 0) * (1 - th.close));
      const frame = (score: number): void => {
        ops.push({ type: 'frame', frame: { t, left: score, right: score } });
      };
      for (const closure of closures) {
        for (const until = t + closure.gap; t < until; t += step()) frame(openScore());
        if (closure.minChange !== null && !closure.changeMid) ops.push({ type: 'setMin', value: closure.minChange });
        const until = t + closure.len;
        frame(closedScore());
        t += step();
        let changed = false;
        for (; t < until; t += step()) {
          frame(closedScore());
          if (closure.minChange !== null && closure.changeMid && !changed) {
            ops.push({ type: 'setMin', value: closure.minChange });
            changed = true;
          }
        }
        if (closure.endBy === 'open') frame(openScore());
        else ops.push({ type: 'frame', frame: { t, face: 'lost' } });
        t += step();
      }
      return ops;
    });
}

export function detectorFor(config: Partial<DetectorConfig> = {}): BlinkDetector {
  const result = createBlinkDetector(config);
  if (!result.ok) {
    throw new Error(`invalid test detector config: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

// ---------------------------------------------------------------------------
// Pure pipeline (Property 17)

export type DomSourceKind = 'keyboard' | 'switch' | 'pointer';

export type PipelineOp =
  | { readonly type: 'raw'; readonly source: DomSourceKind; readonly edge: 'down' | 'up'; readonly t: number }
  | { readonly type: 'frame'; readonly frame: RawBlinkFrame }
  /** A Clock reading: every key and pointer Debouncer advances to it, as their timers would. */
  | { readonly type: 'clock'; readonly now: number }
  | { readonly type: 'detach'; readonly source: SourceKind; readonly now: number };

export interface PipelineConfig {
  readonly minPress: Readonly<Record<DomSourceKind, number>>;
  readonly blink: DetectorConfig;
}

export const pipelineConfigArb: fc.Arbitrary<PipelineConfig> = fc.record({
  minPress: fc.record({ keyboard: validMinArb('keyboard'), switch: validMinArb('switch'), pointer: validMinArb('pointer') }),
  blink: fc
    .tuple(validThresholdsArb, blinkMinArb)
    .map(([th, min]) => ({ closeThreshold: th.close, openThreshold: th.open, minPressDuration: min })),
});

/** Pure Debouncers and a Blink_Detector folded through arbiterStep. Returns the Output_Stream. */
export function runPipeline(config: PipelineConfig, script: readonly PipelineOp[]): PressEvent[] {
  const debouncers: Readonly<Record<DomSourceKind, Debouncer>> = {
    keyboard: createDebouncer('keyboard', config.minPress.keyboard),
    switch: createDebouncer('switch', config.minPress.switch),
    pointer: createDebouncer('pointer', config.minPress.pointer),
  };
  const detector = detectorFor(config.blink);
  let state = INITIAL_ARBITER_STATE;
  const out: PressEvent[] = [];
  const step = (input: ArbiterInput): void => {
    const next = arbiterStep(state, input);
    state = next.state;
    if (next.out !== null) out.push(next.out);
  };
  const feed = (events: readonly PressEvent[]): void => events.forEach((event) => step({ type: 'event', event }));
  for (const op of script) {
    switch (op.type) {
      case 'raw': {
        const debouncer = debouncers[op.source];
        feed(op.edge === 'down' ? debouncer.rawDown(op.t) : debouncer.rawUp(op.t));
        break;
      }
      case 'frame':
        feed(detector.push(op.frame).events);
        break;
      case 'clock':
        for (const kind of ['keyboard', 'switch', 'pointer'] as const) feed(debouncers[kind].advance(op.now));
        break;
      case 'detach':
        step({ type: 'detach', source: op.source, now: op.now });
        break;
    }
  }
  return out;
}

/** Mixed scripts on one running integer clock (steps in [-30, 200], about 1 in 30 times non-finite). */
export const pipelineScriptArb: fc.Arbitrary<readonly PipelineOp[]> = fc
  .array(
    fc.record({
      type: fc.oneof(
        { weight: 6, arbitrary: fc.constant('raw' as const) },
        { weight: 6, arbitrary: fc.constant('frame' as const) },
        { weight: 3, arbitrary: fc.constant('clock' as const) },
        { weight: 1, arbitrary: fc.constant('detach' as const) },
      ),
      source: fc.constantFrom<DomSourceKind>('keyboard', 'switch', 'pointer'),
      detachSource: sourceKindArb,
      edge: fc.constantFrom<'down' | 'up'>('down', 'up'),
      step: fc.integer({ min: -30, max: 200 }),
      bad: fc.oneof({ weight: 29, arbitrary: fc.constant(null) }, { weight: 1, arbitrary: nonFiniteArb }),
      lost: fc.oneof({ weight: 9, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) }),
      left: fc.double({ min: 0, max: 1, noNaN: true }),
      right: fc.double({ min: 0, max: 1, noNaN: true }),
    }),
    { maxLength: 150, size: 'max' },
  )
  .map((draws) => {
    let clock = 0;
    return draws.map(({ type, source, detachSource, edge, step, bad, lost, left, right }): PipelineOp => {
      clock += step;
      const t = bad ?? clock;
      switch (type) {
        case 'raw':
          return { type, source, edge, t };
        case 'frame':
          return { type, frame: lost ? { t, face: 'lost' } : { t, left, right } };
        case 'clock':
          return { type, now: t };
        case 'detach':
          return { type, source: detachSource, now: t };
      }
    });
  });

/** Every timestamp a script hands to the pipeline. */
export function scriptTimes(script: readonly PipelineOp[]): Set<number> {
  return new Set(script.map((op) => (op.type === 'frame' ? op.frame.t : op.type === 'raw' ? op.t : op.now)));
}

/** Freezes an object graph so any mutation throws in strict mode. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

// ---------------------------------------------------------------------------
// Fake browser targets (sources, Properties 14 to 16)

/** Stand-ins for event targets: the surface, a child inside it and an element outside it. */
export const SURFACE_TARGET = Object.freeze({ id: 'surface' });
export const CHILD_TARGET = Object.freeze({ id: 'surface-child' });
export const OUTSIDE_TARGET = Object.freeze({ id: 'outside' });

export interface FakePointerEvent extends PointerEventLike {
  readonly prevented: boolean;
}

export function pointerEvent(init: Partial<Omit<PointerEventLike, 'preventDefault'>> = {}): FakePointerEvent {
  let prevented = false;
  return {
    pointerId: init.pointerId ?? 1,
    isPrimary: init.isPrimary ?? true,
    pointerType: init.pointerType ?? 'touch',
    button: init.button ?? 0,
    target: init.target ?? SURFACE_TARGET,
    preventDefault() {
      prevented = true;
    },
    get prevented() {
      return prevented;
    },
  };
}

/** A Keying_Surface whose capture can fail and whose gesture styles are tracked. */
export interface FakeSurface extends SurfaceElement {
  captureFails: boolean;
  readonly captured: ReadonlySet<number>;
  styleApplied(): boolean;
  dispatch(type: SurfaceEventType, init?: Partial<Omit<PointerEventLike, 'preventDefault'>>): FakePointerEvent;
  listenerCount(): number;
}

export function createFakeSurface(): FakeSurface {
  const listeners = new Set<{ readonly type: SurfaceEventType; readonly fn: (e: PointerEventLike) => void }>();
  const captured = new Set<number>();
  let applied = 0;
  return {
    captureFails: false,
    captured,
    contains: (target) => target === SURFACE_TARGET || target === CHILD_TARGET,
    on(type, fn) {
      const entry = { type, fn };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    setPointerCapture(id) {
      if (this.captureFails) return false;
      captured.add(id);
      return true;
    },
    releasePointerCapture(id) {
      captured.delete(id);
    },
    applyNoGestureStyle() {
      applied++;
      let restored = false;
      return () => {
        if (!restored) applied--;
        restored = true;
      };
    },
    styleApplied: () => applied > 0,
    dispatch(type, init = {}) {
      const event = pointerEvent(init);
      // Browsers release capture implicitly when the pointer goes up or is cancelled.
      if (type !== 'pointerdown' && type !== 'contextmenu') captured.delete(event.pointerId);
      for (const entry of [...listeners]) if (entry.type === type) entry.fn(event);
      return event;
    },
    listenerCount: () => listeners.size,
  };
}

export interface FakeDocPointer extends DocumentPointerTarget {
  dispatch(type: 'pointerup' | 'pointercancel', init?: Partial<Omit<PointerEventLike, 'preventDefault'>>): FakePointerEvent;
  listenerCount(): number;
}

/** `onRelease` sees each dispatched pointer, so a rig can drop that pointer's capture on the surface. */
export function createFakeDocPointer(onRelease?: (pointerId: number) => void): FakeDocPointer {
  const listeners = new Set<{ readonly type: 'pointerup' | 'pointercancel'; readonly fn: (e: PointerEventLike) => void }>();
  return {
    on(type, fn) {
      const entry = { type, fn };
      listeners.add(entry);
      return () => {
        listeners.delete(entry);
      };
    },
    dispatch(type, init = {}) {
      const event = pointerEvent({ target: OUTSIDE_TARGET, ...init });
      onRelease?.(event.pointerId);
      for (const entry of [...listeners]) if (entry.type === type) entry.fn(event);
      return event;
    },
    listenerCount: () => listeners.size,
  };
}

/** Window blur and document visibility, driven by the test. */
export interface FakePage extends PageLifecycle {
  blur(): void;
  hide(): void;
  show(): void;
  listenerCount(): number;
}

export function createFakePage(): FakePage {
  let hidden = false;
  const blur = new Set<() => void>();
  const hiddenListeners = new Set<() => void>();
  const visible = new Set<() => void>();
  const add = (set: Set<() => void>, fn: () => void): Unsubscribe => {
    const own = (): void => fn();
    set.add(own);
    return () => {
      set.delete(own);
    };
  };
  return {
    isHidden: () => hidden,
    onBlur: (fn) => add(blur, fn),
    onHidden: (fn) => add(hiddenListeners, fn),
    onVisible: (fn) => add(visible, fn),
    blur: () => [...blur].forEach((fn) => fn()),
    hide() {
      hidden = true;
      [...hiddenListeners].forEach((fn) => fn());
    },
    show() {
      hidden = false;
      [...visible].forEach((fn) => fn());
    },
    listenerCount: () => blur.size + hiddenListeners.size + visible.size,
  };
}

/** A Settings_Store that records every call and can be told to fail. */
export interface FakeStore extends SettingsStore {
  /** The stored switch key, as raw data. */
  value: unknown;
  /** When set, readSwitchKey returns this instead of `value`. */
  readResult: Result<unknown, StoreError> | null;
  failWrites: boolean;
  failClears: boolean;
  readonly calls: { reads: number; readonly writes: string[]; clears: number };
}

export function createFakeStore(value: unknown = undefined): FakeStore {
  const store: FakeStore = {
    value,
    readResult: null,
    failWrites: false,
    failClears: false,
    calls: { reads: 0, writes: [], clears: 0 },
    readSwitchKey() {
      store.calls.reads++;
      return store.readResult ?? { ok: true, value: store.value };
    },
    writeSwitchKey(code) {
      store.calls.writes.push(code);
      if (store.failWrites) return { ok: false, error: { message: 'write failed' } };
      store.value = code;
      return { ok: true, value: undefined };
    },
    clearSwitchKey() {
      store.calls.clears++;
      if (store.failClears) return { ok: false, error: { message: 'clear failed' } };
      store.value = undefined;
      return { ok: true, value: undefined };
    },
  };
  return store;
}

// ---------------------------------------------------------------------------
// Source rigs

export interface KeyRig {
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  readonly page: FakePage;
  readonly target: FakeKeyTarget;
  readonly router: KeyRouter;
  readonly store: FakeStore;
  readonly keyboard: KeySource;
  readonly switchSource: SwitchSource;
  readonly learner: SwitchLearner;
  /** The focus class every key source sees; tests change it. */
  focus: FocusClass;
  readonly presses: PressEvent[];
  readonly statuses: { readonly source: SourceKind; readonly status: SourceStatus }[];
}

/** A KeyRouter with the Keyboard_Source, Switch_Source and Switch_Learner over fakes, recording all output. */
export function createKeyRig(options: { readonly storedKey?: unknown; readonly min?: number; readonly start?: number } = {}): KeyRig {
  const clock = createManualClock(options.start ?? 1000);
  const scheduler = createManualScheduler(clock.now);
  const page = createFakePage();
  const target = createFakeKeyTarget();
  const router = createKeyRouter(target);
  const store = createFakeStore(options.storedKey);
  const presses: PressEvent[] = [];
  const statuses: { source: SourceKind; status: SourceStatus }[] = [];
  const rig = { focus: 'keying' as FocusClass };
  const deps = {
    router,
    clock: clock.now,
    scheduler,
    page,
    focus: () => rig.focus,
    ...(options.min === undefined ? {} : { minPressDuration: options.min }),
  };
  const keyboard = createKeyboardSource(deps);
  const switchSource = createSwitchSource({ ...deps, store });
  const learner = createSwitchLearner({ router, store, switchSource });
  for (const source of [keyboard, switchSource]) {
    source.onPress((event) => presses.push(event));
    source.onStatus((status) => statuses.push({ source: source.kind, status }));
  }
  return Object.assign(rig, { clock, scheduler, page, target, router, store, keyboard, switchSource, learner, presses, statuses });
}

export interface PointerRig {
  readonly clock: ManualClock;
  readonly scheduler: ManualScheduler;
  readonly page: FakePage;
  readonly surface: FakeSurface;
  readonly doc: FakeDocPointer;
  readonly pointer: PointerSource;
  readonly presses: PressEvent[];
  readonly statuses: SourceStatus[];
}

export function createPointerRig(options: { readonly min?: number; readonly noSurface?: boolean } = {}): PointerRig {
  const clock = createManualClock(1000);
  const scheduler = createManualScheduler(clock.now);
  const page = createFakePage();
  const surface = createFakeSurface();
  const doc = createFakeDocPointer((pointerId) => surface.releasePointerCapture(pointerId));
  const pointer = createPointerSource({
    surface: () => (options.noSurface === true ? null : surface),
    doc,
    clock: clock.now,
    scheduler,
    page,
    ...(options.min === undefined ? {} : { minPressDuration: options.min }),
  });
  const presses: PressEvent[] = [];
  const statuses: SourceStatus[] = [];
  pointer.onPress((event) => presses.push(event));
  pointer.onStatus((status) => statuses.push(status));
  return { clock, scheduler, page, surface, doc, pointer, presses, statuses };
}

// ---------------------------------------------------------------------------
// Blink devices (blink/source.ts)

export interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

/** A promise the test settles by hand. */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Lets every pending promise callback run. */
export async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

export interface FakeTrack extends CameraTrack {
  readonly stops: number;
  /** The camera ends the track by itself (unplugged, revoked). */
  end(): void;
  listenerCount(): number;
}

export function createFakeTrack(): FakeTrack {
  let state: 'live' | 'ended' = 'live';
  let stops = 0;
  const ended = new Set<() => void>();
  return {
    stop() {
      stops++;
      state = 'ended';
    },
    onEnded(fn) {
      const own = (): void => fn();
      ended.add(own);
      return () => {
        ended.delete(own);
      };
    },
    get readyState() {
      return state;
    },
    get stops() {
      return stops;
    },
    end() {
      state = 'ended';
      [...ended].forEach((fn) => fn());
    },
    listenerCount: () => ended.size,
  };
}

export interface FakeStream extends CameraStream {
  readonly tracks: readonly FakeTrack[];
}

export function createFakeStream(trackCount = 1): FakeStream {
  return { tracks: Array.from({ length: trackCount }, () => createFakeTrack()) };
}

export interface FakeLandmarker extends Landmarker {
  /** What detect() returns next; a function result is computed per call. */
  scores: { left: number | undefined; right: number | undefined } | null;
  throwOnDetect: boolean;
  readonly detected: number[];
  readonly closes: number;
}

export function createFakeLandmarker(): FakeLandmarker {
  let closes = 0;
  const landmarker: FakeLandmarker = {
    scores: { left: 0.05, right: 0.05 },
    throwOnDetect: false,
    detected: [],
    get closes() {
      return closes;
    },
    detect(t) {
      if (landmarker.throwOnDetect) throw new Error('detect failed');
      landmarker.detected.push(t);
      return landmarker.scores;
    },
    close() {
      closes++;
    },
  };
  return landmarker;
}

export interface FakeBlinkDevices extends BlinkDevices {
  supported: boolean;
  readonly cameraRequests: Deferred<CameraStream>[];
  readonly landmarkerRequests: Deferred<Landmarker>[];
  readonly loops: { readonly stream: CameraStream; readonly onFrame: (t: number) => void; stopped: boolean }[];
  /** Sends a frame to the newest running loop. */
  frame(t: number): void;
}

export function createFakeBlinkDevices(): FakeBlinkDevices {
  const devices: FakeBlinkDevices = {
    supported: true,
    cameraRequests: [],
    landmarkerRequests: [],
    loops: [],
    isSupported: () => devices.supported,
    openCamera() {
      const request = deferred<CameraStream>();
      devices.cameraRequests.push(request);
      return request.promise;
    },
    loadLandmarker() {
      const request = deferred<Landmarker>();
      devices.landmarkerRequests.push(request);
      return request.promise;
    },
    startFrames(stream, onFrame) {
      const loop = { stream, onFrame, stopped: false };
      devices.loops.push(loop);
      return {
        stop() {
          loop.stopped = true;
        },
      };
    },
    frame(t) {
      const loop = [...devices.loops].reverse().find((candidate) => !candidate.stopped);
      loop?.onFrame(t);
    },
  };
  return devices;
}
