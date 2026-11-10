import { adaptEstimates } from './adapt';
import { lookupPattern, type Lookup } from './codes';
import { err, ok, type Result } from './result';
import {
  DEFAULT_ADAPTATION_RATE,
  DEFAULT_WPM,
  MAX_START_WPM,
  MAX_SYMBOLS,
  MIN_START_WPM,
  applyEstimateGuards,
  isFiniteNumber,
  thresholds,
  wpmToUnit,
} from './timing';
import type {
  EngineConfig,
  EngineConfigError,
  EngineEvent,
  EngineMode,
  EstimateSnapshot,
  Estimates,
  MorseSymbol,
} from './types';

export interface DecoderState {
  readonly mode: EngineMode;
  readonly alpha: number;
  readonly estimates: Estimates;
  readonly switchDown: boolean;
  /** Non-null iff switchDown. */
  readonly pressStart: number | null;
  /** Most recent accepted Release (duration > 0) since creation or reset. */
  readonly lastRelease: number | null;
  /** Timestamp of the last accepted input; survives reset(). */
  readonly lastT: number | null;
  /** Pattern_Buffer: 0–9 symbols between inputs. */
  readonly buffer: string;
  readonly spaceEligible: boolean;
}

export type EngineInput =
  | { readonly type: 'press'; readonly t: number }
  | { readonly type: 'release'; readonly t: number }
  | { readonly type: 'tick'; readonly t: number }
  | { readonly type: 'reset' };

export interface StepResult {
  readonly state: DecoderState;
  readonly events: readonly EngineEvent[];
}

export interface Engine {
  press(t: number): readonly EngineEvent[];
  release(t: number): readonly EngineEvent[];
  tick(t: number): readonly EngineEvent[];
  /** Clears the character in progress, keeps the learned speed, emits nothing (Req 10). */
  reset(): void;
  /** The next time a gap threshold is crossed, or null. No side effects (Req 7.7). */
  nextDeadline(): number | null;
  /** Current estimates and thresholds. No side effects (Req 1.11). */
  estimates(): EstimateSnapshot;
  readonly mode: EngineMode;
  /** Read-only snapshot for tests and debugging. */
  snapshot(): DecoderState;
}

const NO_EVENTS: readonly EngineEvent[] = Object.freeze([]);

function unchanged(state: DecoderState): StepResult {
  return { state, events: NO_EVENTS };
}

function initialState(mode: EngineMode, alpha: number, estimates: Estimates): DecoderState {
  return {
    mode,
    alpha,
    estimates,
    switchDown: false,
    pressStart: null,
    lastRelease: null,
    lastT: null,
    buffer: '',
    spaceEligible: false,
  };
}

/** Pure transition. Never throws. */
export function step(state: DecoderState, input: EngineInput): StepResult {
  if (input.type === 'reset') {
    return { state: resetState(state), events: NO_EVENTS };
  }
  const { t } = input;
  if (!isFiniteNumber(t)) {
    return unchanged(state); // Req 2.8
  }
  if (state.lastT !== null && t < state.lastT) {
    return unchanged(state); // Req 2.6: equal timestamps pass
  }
  switch (input.type) {
    case 'press':
      return press(state, t);
    case 'release':
      return release(state, t);
    case 'tick':
      return tick(state, t);
  }
}

/** Pure: the deadline for a state (Req 7.1–7.4). Same expressions as settleGaps, so tick(deadline) always acts. */
export function deadlineOf(state: DecoderState): number | null {
  if (state.switchDown || state.lastRelease === null) {
    return null;
  }
  const limits = thresholds(state.estimates);
  if (state.buffer !== '') {
    return state.lastRelease + limits.letterGapThreshold;
  }
  if (state.spaceEligible) {
    return state.lastRelease + limits.wordGapThreshold;
  }
  return null;
}

function press(state: DecoderState, t: number): StepResult {
  if (state.switchDown) {
    return unchanged(state); // Req 2.4: lastT is not advanced
  }
  const settled = settleGaps({ ...state, lastT: t }, t, thresholds(state.estimates));
  return {
    state: { ...settled.state, switchDown: true, pressStart: t },
    events: settled.events,
  };
}

function release(state: DecoderState, t: number): StepResult {
  const { pressStart } = state;
  if (!state.switchDown || pressStart === null) {
    return unchanged(state); // Req 2.5, 10.6
  }
  const up: DecoderState = { ...state, lastT: t, switchDown: false, pressStart: null };
  if (t <= pressStart) {
    return { state: up, events: NO_EVENTS }; // Req 2.3: lastRelease, buffer and estimates unchanged
  }
  // Classify with the thresholds held before this release adapts anything (Req 1.10, 8.4).
  const limits = thresholds(state.estimates);
  const symbol: MorseSymbol = t >= pressStart + limits.dotDashThreshold ? '-' : '.';
  const estimates =
    state.mode === 'adaptive'
      ? adaptEstimates(state.estimates, symbol, t - pressStart, state.alpha)
      : state.estimates;
  const buffer = state.buffer + symbol;
  if (buffer.length >= MAX_SYMBOLS) {
    return {
      state: { ...up, estimates, lastRelease: t, buffer: '', spaceEligible: false },
      events: [
        { type: 'symbol', symbol },
        { type: 'unknown', pattern: buffer },
      ], // Req 2.7
    };
  }
  return {
    state: { ...up, estimates, lastRelease: t, buffer },
    events: [{ type: 'symbol', symbol }],
  };
}

function tick(state: DecoderState, t: number): StepResult {
  const advanced: DecoderState = { ...state, lastT: t };
  if (state.switchDown) {
    return { state: advanced, events: NO_EVENTS }; // Req 7.4
  }
  return settleGaps(advanced, t, thresholds(state.estimates));
}

/**
 * Lazily settle the gaps that the silence up to `t` has crossed: commit the buffered pattern at the
 * letter gap, then emit one space at the word gap if a character was just committed (Req 5, 6).
 * Uses the deadline form `t >= lastRelease + threshold` so the result agrees with deadlineOf.
 */
function settleGaps(state: DecoderState, t: number, limits: EstimateSnapshot): StepResult {
  const { lastRelease } = state;
  if (lastRelease === null) {
    return unchanged(state);
  }
  const events: EngineEvent[] = [];
  let { buffer, spaceEligible } = state;
  if (buffer !== '' && t >= lastRelease + limits.letterGapThreshold) {
    const found = lookupPattern(buffer);
    events.push(commitEvent(found));
    spaceEligible = found.kind === 'char';
    buffer = '';
  }
  if (buffer === '' && spaceEligible && t >= lastRelease + limits.wordGapThreshold) {
    events.push({ type: 'space' });
    spaceEligible = false;
  }
  if (events.length === 0) {
    return unchanged(state);
  }
  return { state: { ...state, buffer, spaceEligible }, events };
}

function commitEvent(found: Lookup): EngineEvent {
  switch (found.kind) {
    case 'command':
      return { type: 'command', command: found.command };
    case 'char':
      return { type: 'char', char: found.char };
    case 'unknown':
      return { type: 'unknown', pattern: found.pattern };
  }
}

/** Clears the character in progress and the switch state; keeps estimates, alpha, mode and lastT (Req 10). */
function resetState(state: DecoderState): DecoderState {
  return {
    ...state,
    switchDown: false,
    pressStart: null,
    lastRelease: null,
    buffer: '',
    spaceEligible: false,
  };
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

/** Validates every setting, reports each invalid one, and returns no Engine on failure (Req 1). */
export function createEngine(config?: EngineConfig): Result<Engine, readonly EngineConfigError[]> {
  const settings: EngineConfig = config ?? {};
  const { startingWpm, adaptationRate, initialDotEstimate, initialDashEstimate } = settings;
  const errors: EngineConfigError[] = [];

  if (
    startingWpm !== undefined &&
    !(isFiniteNumber(startingWpm) && startingWpm >= MIN_START_WPM && startingWpm <= MAX_START_WPM)
  ) {
    errors.push({ setting: 'startingWpm', value: startingWpm });
  }
  if (
    adaptationRate !== undefined &&
    !(isFiniteNumber(adaptationRate) && adaptationRate > 0 && adaptationRate <= 1)
  ) {
    errors.push({ setting: 'adaptationRate', value: adaptationRate });
  }

  const dotGiven = initialDotEstimate !== undefined;
  const dashGiven = initialDashEstimate !== undefined;
  if (dotGiven && !isPositiveNumber(initialDotEstimate)) {
    errors.push({ setting: 'initialDotEstimate', value: initialDotEstimate, reason: 'invalid' });
  } else if (!dotGiven && dashGiven) {
    errors.push({ setting: 'initialDotEstimate', value: initialDotEstimate, reason: 'missing' });
  }
  if (dashGiven && !isPositiveNumber(initialDashEstimate)) {
    errors.push({ setting: 'initialDashEstimate', value: initialDashEstimate, reason: 'invalid' });
  } else if (!dashGiven && dotGiven) {
    errors.push({ setting: 'initialDashEstimate', value: initialDashEstimate, reason: 'missing' });
  }

  if (errors.length > 0) {
    return err(errors);
  }

  const startingUnit = wpmToUnit(startingWpm ?? DEFAULT_WPM);
  // Guards are idempotent, so estimates that came from calibrate() are kept exactly (Req 11.6).
  const estimates = applyEstimateGuards(
    initialDotEstimate !== undefined && initialDashEstimate !== undefined
      ? { dotEstimate: initialDotEstimate, dashEstimate: initialDashEstimate }
      : { dotEstimate: startingUnit, dashEstimate: 3 * startingUnit },
  );
  const mode: EngineMode = settings.mode === 'fixed' ? 'fixed' : 'adaptive';
  let state = initialState(mode, adaptationRate ?? DEFAULT_ADAPTATION_RATE, estimates);

  const run = (input: EngineInput): readonly EngineEvent[] => {
    const result = step(state, input);
    state = result.state;
    return result.events;
  };

  const engine: Engine = {
    press: (t) => run({ type: 'press', t }),
    release: (t) => run({ type: 'release', t }),
    tick: (t) => run({ type: 'tick', t }),
    reset: () => {
      run({ type: 'reset' });
    },
    nextDeadline: () => deadlineOf(state),
    estimates: () => thresholds(state.estimates),
    mode,
    snapshot: () => state,
  };
  return ok(Object.freeze(engine));
}

/** Decoded_Text: chars concatenated, one ' ' per space event. */
export function decodedText(events: readonly EngineEvent[]): string {
  let text = '';
  for (const event of events) {
    if (event.type === 'char') {
      text += event.char;
    } else if (event.type === 'space') {
      text += ' ';
    }
  }
  return text;
}
