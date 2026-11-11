import { err, ok, pressEvent, type PressEvent, type Result, type SettingError, type SourceKind } from './types';

/** Inclusive valid Min_Press_Duration range per Source_Kind, in ms (Req 3.8). */
export const MIN_PRESS_RANGES: Readonly<Record<SourceKind, { readonly min: number; readonly max: number }>> =
  Object.freeze({
    keyboard: Object.freeze({ min: 0, max: 500 }),
    switch: Object.freeze({ min: 0, max: 500 }),
    pointer: Object.freeze({ min: 0, max: 500 }),
    blink: Object.freeze({ min: 50, max: 2000 }),
  });

/** Default Min_Press_Duration per Source_Kind, in ms. */
export const DEFAULT_MIN_PRESS: Readonly<Record<SourceKind, number>> = Object.freeze({
  keyboard: 30,
  switch: 30,
  pointer: 30,
  blink: 200,
});

/** A finite number inside the kind's inclusive range, else a failed Result naming the kind and setting. */
export function validateMinPressDuration(kind: SourceKind, value: unknown): Result<number, SettingError> {
  const range = MIN_PRESS_RANGES[kind];
  if (typeof value === 'number' && Number.isFinite(value) && value >= range.min && value <= range.max) {
    // -0 is stored as 0 so equal settings compare equal.
    return ok(value === 0 ? 0 : value);
  }
  return err({
    source: kind,
    setting: 'minPressDuration',
    value,
    message: `The ${kind} minimum press must be a number from ${range.min} to ${range.max} ms.`,
  });
}

export type DebounceState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'pending'; readonly downT: number; readonly min: number }
  | { readonly phase: 'confirmed'; readonly downT: number };

export type DebounceInput =
  | { readonly type: 'rawDown'; readonly t: number }
  | { readonly type: 'rawUp'; readonly t: number }
  | { readonly type: 'advance'; readonly now: number }
  /** Blur, hidden or stop: drop a Pending_Press (Req 1.4, 7.3). */
  | { readonly type: 'cancel' }
  /** End a Confirmed_Press at max(now, downT) (Req 1.5, 7.1, 7.2). */
  | { readonly type: 'forceUp'; readonly now: number };

export interface DebounceStep {
  readonly state: DebounceState;
  readonly events: readonly PressEvent[];
}

const IDLE: DebounceState = Object.freeze({ phase: 'idle' });
const NO_EVENTS: readonly PressEvent[] = Object.freeze([]);

function unchanged(state: DebounceState): DebounceStep {
  return { state, events: NO_EVENTS };
}

function timeOf(input: DebounceInput): number | null {
  switch (input.type) {
    case 'rawDown':
    case 'rawUp':
      return input.t;
    case 'advance':
    case 'forceUp':
      return input.now;
    case 'cancel':
      return null;
  }
}

/**
 * One transition of the debounce table in the design. `min` is the setting in effect now; it is
 * captured into the pending state at Raw_Down, so a later change applies from the next press
 * (Req 3.8). Durations use the deadline form `t >= downT + min`. Inputs with a non-finite time
 * change nothing. A non-finite or negative `min` counts as 0.
 */
export function debounceStep(state: DebounceState, input: DebounceInput, kind: SourceKind, min: number): DebounceStep {
  const t = timeOf(input);
  if (t !== null && !Number.isFinite(t)) {
    return unchanged(state);
  }
  switch (state.phase) {
    case 'idle':
      return idleStep(state, input, kind, Number.isFinite(min) && min > 0 ? min : 0);
    case 'pending':
      return pendingStep(state, input, kind);
    case 'confirmed':
      return confirmedStep(state, input, kind);
  }
}

function idleStep(state: DebounceState, input: DebounceInput, kind: SourceKind, min: number): DebounceStep {
  if (input.type !== 'rawDown') {
    return unchanged(state);
  }
  if (min === 0) {
    // Req 3.7: no Pending_Press; down is emitted while processing the Raw_Down.
    return { state: { phase: 'confirmed', downT: input.t }, events: [pressEvent('down', input.t, kind)] };
  }
  return { state: { phase: 'pending', downT: input.t, min }, events: NO_EVENTS };
}

function pendingStep(
  state: Extract<DebounceState, { phase: 'pending' }>,
  input: DebounceInput,
  kind: SourceKind,
): DebounceStep {
  switch (input.type) {
    case 'rawDown':
      return unchanged(state);
    case 'advance':
      if (input.now >= state.downT + state.min) {
        return { state: { phase: 'confirmed', downT: state.downT }, events: [pressEvent('down', state.downT, kind)] };
      }
      return unchanged(state);
    case 'rawUp': {
      // Req 3.11: a Raw_Up earlier than the Raw_Down counts as a 0 ms press.
      const upT = Math.max(input.t, state.downT);
      if (upT >= state.downT + state.min) {
        return { state: IDLE, events: [pressEvent('down', state.downT, kind), pressEvent('up', upT, kind)] };
      }
      return { state: IDLE, events: NO_EVENTS };
    }
    case 'cancel':
    case 'forceUp':
      return { state: IDLE, events: NO_EVENTS };
  }
}

function confirmedStep(
  state: Extract<DebounceState, { phase: 'confirmed' }>,
  input: DebounceInput,
  kind: SourceKind,
): DebounceStep {
  switch (input.type) {
    case 'rawDown':
    case 'advance':
    case 'cancel':
      return unchanged(state);
    case 'rawUp':
      return { state: IDLE, events: [pressEvent('up', Math.max(input.t, state.downT), kind)] };
    case 'forceUp':
      return { state: IDLE, events: [pressEvent('up', Math.max(input.now, state.downT), kind)] };
  }
}

export interface Debouncer {
  readonly kind: SourceKind;
  rawDown(t: number): readonly PressEvent[];
  rawUp(t: number): readonly PressEvent[];
  advance(now: number): readonly PressEvent[];
  cancel(): void;
  forceUp(now: number): readonly PressEvent[];
  /** phase === 'confirmed'. */
  isHeld(): boolean;
  /** downT while a press is pending, else null. */
  pendingSince(): number | null;
  /** downT + min while a press is pending, else null. */
  deadline(): number | null;
  minPressDuration(): number;
  setMinPressDuration(value: unknown): Result<number, SettingError>;
  /** Read-only snapshot of the current state, for tests and replays. */
  state(): DebounceState;
}

/** A stateful Debouncer. An invalid or missing initial `min` falls back to the kind's default. */
export function createDebouncer(kind: SourceKind, min?: number): Debouncer {
  const initial = validateMinPressDuration(kind, min);
  let current = initial.ok ? initial.value : DEFAULT_MIN_PRESS[kind];
  let state: DebounceState = IDLE;

  const run = (input: DebounceInput): readonly PressEvent[] => {
    const next = debounceStep(state, input, kind, current);
    state = next.state;
    return next.events;
  };

  return {
    kind,
    rawDown: (t) => run({ type: 'rawDown', t }),
    rawUp: (t) => run({ type: 'rawUp', t }),
    advance: (now) => run({ type: 'advance', now }),
    cancel: () => {
      run({ type: 'cancel' });
    },
    forceUp: (now) => run({ type: 'forceUp', now }),
    isHeld: () => state.phase === 'confirmed',
    pendingSince: () => (state.phase === 'pending' ? state.downT : null),
    deadline: () => (state.phase === 'pending' ? state.downT + state.min : null),
    minPressDuration: () => current,
    setMinPressDuration(value) {
      const result = validateMinPressDuration(kind, value);
      if (result.ok) {
        current = result.value;
      }
      return result;
    },
    state: () => state,
  };
}
