/**
 * fast-check arbitraries and replay helpers shared by the engine tests.
 * Imported only by test files; never re-exported from index.ts.
 */
import fc from 'fast-check';
import { COMMAND_TABLE, SUPPORTED_CHARACTERS } from './codes';
import { createEngine, type DecoderState, type Engine, type EngineInput } from './decoder';
import { encode, type EncodedSequence, type PressInput } from './encode';
import { applyEstimateGuards } from './timing';
import type { EngineConfig, EngineEvent, EngineMode, Estimates } from './types';

/** Minimum fast-check runs for every engine property. */
export const PROP_RUNS = 200;

// ---------------------------------------------------------------------------
// Replay helpers

/** createEngine for configs a test knows are valid. */
export function engineFor(config?: EngineConfig): Engine {
  const result = createEngine(config);
  if (!result.ok) {
    throw new Error(`invalid test config: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Sends one input to the engine the way production code does. reset() returns no events. */
export function apply(engine: Engine, input: EngineInput): readonly EngineEvent[] {
  switch (input.type) {
    case 'press':
      return engine.press(input.t);
    case 'release':
      return engine.release(input.t);
    case 'tick':
      return engine.tick(input.t);
    case 'reset':
      engine.reset();
      return [];
  }
}

export interface FeedResult {
  /** The event list returned by each call, in call order. */
  readonly perCall: readonly (readonly EngineEvent[])[];
  /** All events concatenated in call order. */
  readonly events: readonly EngineEvent[];
}

/** Replays inputs in order. `observe` sees each call with the engine state before and after it. */
export function feed(
  engine: Engine,
  inputs: readonly EngineInput[],
  observe?: (call: {
    readonly input: EngineInput;
    readonly events: readonly EngineEvent[];
    readonly before: DecoderState;
    readonly after: DecoderState;
  }) => void,
): FeedResult {
  const perCall: (readonly EngineEvent[])[] = [];
  for (const input of inputs) {
    const before = engine.snapshot();
    const events = apply(engine, input);
    observe?.({ input, events, before, after: engine.snapshot() });
    perCall.push(events);
  }
  return { perCall, events: perCall.flat() };
}

/** encode() for text a test knows is supported. */
export function encodeOrThrow(text: string, unit: number): EncodedSequence {
  const result = encode(text, unit);
  if (!result.ok) {
    throw new Error(`cannot encode ${JSON.stringify(text)} at ${unit}: ${JSON.stringify(result.error)}`);
  }
  return result.value;
}

/** Encoded press/release inputs followed by one tick at End_Time. */
export function withEndTick(sequence: EncodedSequence): readonly EngineInput[] {
  return [...sequence.inputs, { type: 'tick', t: sequence.endTime }];
}

export function timeOf(input: EngineInput): number | null {
  return input.type === 'reset' || !Number.isFinite(input.t) ? null : input.t;
}

// ---------------------------------------------------------------------------
// Estimates and configuration (Properties 3 and 4)

const rawEstimateArb = fc.oneof(
  fc.double({ min: 1e-3, max: 1e5, noNaN: true }),
  fc.constantFrom(60, 1500, 4500, 2250),
);

/** Any finite positive estimates, including values far outside the guard bounds. */
export const rawEstimatesArb: fc.Arbitrary<Estimates> = fc.record({
  dotEstimate: rawEstimateArb,
  dashEstimate: rawEstimateArb,
});

/** Estimates that already satisfy the Estimate_Guards. */
export const guardedEstimatesArb: fc.Arbitrary<Estimates> = rawEstimatesArb.map(applyEstimateGuards);

export const modeArb: fc.Arbitrary<EngineMode> = fc.constantFrom('adaptive', 'fixed');

/** Valid values per setting. */
export const validFieldArb = {
  startingWpm: fc.oneof(fc.double({ min: 2, max: 20, noNaN: true }), fc.constantFrom(2, 6, 20)),
  adaptationRate: fc.oneof(
    fc.double({ min: 0, max: 1, minExcluded: true, noNaN: true }),
    fc.constantFrom(0.15, 1),
  ),
  estimate: fc.oneof(
    fc.double({ min: 0, max: 1e6, minExcluded: true, noNaN: true }),
    fc.constantFrom(60, 200, 600, 1500, 4500),
  ),
  mode: modeArb,
} as const;

const nonNumberArb = fc.constantFrom<unknown>('6', '', null, true, {}, []);

/** Invalid values per numeric setting: NaN, ±Infinity, zero, negatives, out-of-range numbers and non-numbers. */
export const invalidFieldArb = {
  startingWpm: fc.oneof(
    fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -0, -6, 1.999, 20.001),
    fc.double({ max: 2, maxExcluded: true }),
    fc.double({ min: 20, minExcluded: true }),
    nonNumberArb,
  ),
  adaptationRate: fc.oneof(
    fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -0, -0.15, 1.0001),
    fc.double({ max: 0 }),
    fc.double({ min: 1, minExcluded: true }),
    nonNumberArb,
  ),
  estimate: fc.oneof(
    fc.constantFrom(Number.NaN, Infinity, -Infinity, 0, -0, -200),
    fc.double({ max: 0 }),
    nonNumberArb,
  ),
} as const;

/** Valid configurations: every field optional, the two estimates both present or both absent. */
export const validConfigArb: fc.Arbitrary<EngineConfig> = fc
  .tuple(
    fc.record(
      {
        startingWpm: validFieldArb.startingWpm,
        adaptationRate: validFieldArb.adaptationRate,
        mode: modeArb,
      },
      { requiredKeys: [] },
    ),
    fc.option(
      fc.record({
        initialDotEstimate: validFieldArb.estimate,
        initialDashEstimate: validFieldArb.estimate,
      }),
      { nil: undefined },
    ),
  )
  .map(([base, estimates]) => (estimates === undefined ? base : { ...base, ...estimates }));

/** Valid configurations pinned to one mode. */
export function configArb(mode: EngineMode): fc.Arbitrary<EngineConfig> {
  return validConfigArb.map((config) => ({ ...config, mode }));
}

// ---------------------------------------------------------------------------
// Text (Properties 18 to 21)

export const UPPERCASE_LETTERS: readonly string[] = Array.from({ length: 26 }, (_, i) =>
  String.fromCharCode(65 + i),
);
export const WHITESPACE_CHARS: readonly string[] = [' ', '\t', '\n', '\r'];

/** A non-Whitespace character the encoder accepts: the 49 Supported_Characters or A–Z. */
export const supportedCharArb: fc.Arbitrary<string> = fc.constantFrom(
  ...SUPPORTED_CHARACTERS,
  ...UPPERCASE_LETTERS,
);

const textCharArb = fc.oneof(
  { weight: 4, arbitrary: supportedCharArb },
  { weight: 1, arbitrary: fc.constantFrom(...WHITESPACE_CHARS) },
);

const hasContent = (text: string): boolean => /[^ \t\n\r]/.test(text);

function supportedTextArb(maxLength: number): fc.Arbitrary<string> {
  return fc
    .array(textCharArb, { minLength: 1, maxLength, size: 'max' })
    .map((chars) => chars.join(''))
    .filter(hasContent);
}

/** Supported_Strings of 1–200 characters, about 4 non-Whitespace characters to 1 Whitespace. */
export const supportedStringArb: fc.Arbitrary<string> = supportedTextArb(200);

/** One word: Supported_Characters and A–Z only, no Whitespace. */
export const wordArb: fc.Arbitrary<string> = fc
  .array(supportedCharArb, { minLength: 1, maxLength: 12 })
  .map((chars) => chars.join(''));

/** Units across the encoder's whole range, with the ends and the default mixed in. */
export const unitArb: fc.Arbitrary<number> = fc.oneof(
  fc.double({ min: 60, max: 1500, noNaN: true }),
  fc.constantFrom(60, 200, 1500),
);

export interface KeyedText {
  readonly text: string;
  readonly unit: number;
  /** encode(text, unit) as engine inputs, then a tick at End_Time that commits the last character. */
  readonly inputs: readonly EngineInput[];
  readonly endTime: number;
}

/** Realistic keying: a Supported_String encoded at a unit. */
export const keyedTextArb: fc.Arbitrary<KeyedText> = fc
  .tuple(supportedStringArb, unitArb)
  .map(([text, unit]) => {
    const encoded = encodeOrThrow(text, unit);
    return { text, unit, inputs: withEndTick(encoded), endTime: encoded.endTime };
  });

export interface JitteredSequence {
  readonly text: string;
  readonly unit: number;
  readonly base: EncodedSequence;
  readonly jittered: EncodedSequence;
}

/** Endpoint-biased Jitter_Factors in [0.7, 1.3]. */
const factorArb = fc.oneof(
  fc.double({ min: 0.7, max: 1.3, noNaN: true }),
  fc.constantFrom(0.7, 1.3),
);

/**
 * Element lengths of an encoded sequence: every press length and gap in order, then the final
 * gap from the last release to End_Time.
 */
function elementLengths(sequence: EncodedSequence): readonly number[] {
  const times = sequence.inputs.map((input) => input.t);
  const lengths = times.slice(1).map((t, i) => t - (times[i] ?? 0));
  return [...lengths, sequence.endTime - (times.at(-1) ?? 0)];
}

/** Rebuilds timestamps as running sums of jittered lengths; the first press stays at 0 (Req 14.1). */
function applyJitter(
  sequence: EncodedSequence,
  lengths: readonly number[],
  factors: readonly number[],
): EncodedSequence {
  const scaled = lengths.map((length, i) => length * (factors[i] ?? 1));
  const inputs: PressInput[] = [];
  let t = 0;
  sequence.inputs.forEach((input, i) => {
    if (i > 0) t += scaled[i - 1] ?? 0;
    inputs.push({ type: input.type, t });
  });
  return { inputs, endTime: t + (scaled.at(-1) ?? 0) };
}

/** A Supported_String and unit with an independent Jitter_Factor on every press and gap. */
export const jitteredSequenceArb: fc.Arbitrary<JitteredSequence> = fc
  .tuple(supportedStringArb, unitArb)
  .chain(([text, unit]) => {
    const base = encodeOrThrow(text, unit);
    const lengths = elementLengths(base);
    return fc
      .array(factorArb, { minLength: lengths.length, maxLength: lengths.length })
      .map((factors) => ({ text, unit, base, jittered: applyJitter(base, lengths, factors) }));
  });

// ---------------------------------------------------------------------------
// Random input sequences

type TimedKind = 'press' | 'release' | 'tick';

type Action =
  | { readonly kind: 'input'; readonly input: TimedKind; readonly dt: number }
  | { readonly kind: 'reset' }
  | {
      readonly kind: 'bad';
      readonly input: TimedKind;
      readonly bad: 'nan' | 'inf' | '-inf' | 'stale';
      readonly delta: number;
    }
  | { readonly kind: 'keyed'; readonly dt: number; readonly text: string }
  | { readonly kind: 'command'; readonly dt: number; readonly code: string };

export interface InputSequenceOptions {
  /** Leave out reset() calls. */
  readonly noReset?: boolean;
  /** Bad timestamps are only non-finite, so finite timestamps never decrease. */
  readonly monotonic?: boolean;
  /** Milliseconds per unit multiple. A number pins it; the default draws from [60, 600]. */
  readonly durationScale?: number | fc.Arbitrary<number>;
  /** At most this many actions (default 80). A keyed fragment counts as one action. */
  readonly maxActions?: number;
}

/** Unit multiples that hit every classification region: < 1, the nominal lengths and thresholds, and wide gaps. */
const dtArb = fc.oneof(
  fc.double({ min: 0, max: 0.5, noNaN: true }),
  fc.constantFrom(1, 2, 3, 4.5, 7),
  fc.double({ min: 0, max: 12, noNaN: true }),
);

const timedKindArb = fc.constantFrom<TimedKind>('press', 'release', 'tick');

/** Fragments are encoded at this unit, then rescaled to the sequence's duration scale. */
const FRAGMENT_UNIT = 100;

function actionArb(options: InputSequenceOptions): fc.Arbitrary<Action> {
  const badKinds =
    options.monotonic === true
      ? (['nan', 'inf', '-inf'] as const)
      : (['nan', 'inf', '-inf', 'stale'] as const);
  const weighted: fc.WeightedArbitrary<Action>[] = [
    {
      weight: 16,
      arbitrary: fc.record({ kind: fc.constant('input' as const), input: timedKindArb, dt: dtArb }),
    },
    {
      weight: 3,
      arbitrary: fc.record({
        kind: fc.constant('keyed' as const),
        dt: dtArb,
        text: supportedTextArb(8),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('command' as const),
        dt: dtArb,
        code: fc.constantFrom(...Object.keys(COMMAND_TABLE)),
      }),
    },
    {
      weight: 1,
      arbitrary: fc.record({
        kind: fc.constant('bad' as const),
        input: timedKindArb,
        bad: fc.constantFrom(...badKinds),
        delta: fc.double({ min: 1e-3, max: 10, noNaN: true }),
      }),
    },
  ];
  if (options.noReset !== true) {
    weighted.push({ weight: 1, arbitrary: fc.constant({ kind: 'reset' as const }) });
  }
  return fc.oneof(...weighted);
}

function badTimestamp(bad: 'nan' | 'inf' | '-inf' | 'stale', clock: number, delta: number): number {
  switch (bad) {
    case 'nan':
      return Number.NaN;
    case 'inf':
      return Infinity;
    case '-inf':
      return -Infinity;
    case 'stale':
      return clock - delta;
  }
}

function buildInputs(actions: readonly Action[], scale: number): EngineInput[] {
  const inputs: EngineInput[] = [];
  let clock = 0;
  for (const action of actions) {
    switch (action.kind) {
      case 'input':
        clock += action.dt * scale;
        inputs.push({ type: action.input, t: clock });
        break;
      case 'reset':
        inputs.push({ type: 'reset' });
        break;
      case 'bad':
        inputs.push({ type: action.input, t: badTimestamp(action.bad, clock, action.delta * scale) });
        break;
      case 'keyed': {
        const start = clock + action.dt * scale;
        const encoded = encodeOrThrow(action.text, FRAGMENT_UNIT);
        for (const input of encoded.inputs) {
          inputs.push({ type: input.type, t: start + (input.t / FRAGMENT_UNIT) * scale });
        }
        clock = start + (encoded.endTime / FRAGMENT_UNIT) * scale;
        break;
      }
      case 'command': {
        // A command code keyed with 1-unit gaps, then a 3-unit pause like a letter.
        let k = action.dt;
        [...action.code].forEach((symbol, index) => {
          if (index > 0) k += 1;
          inputs.push({ type: 'press', t: clock + k * scale });
          k += symbol === '.' ? 1 : 3;
          inputs.push({ type: 'release', t: clock + k * scale });
        });
        clock += (k + 3) * scale;
        break;
      }
    }
  }
  return inputs;
}

/**
 * 0–80 actions: presses, releases and ticks spaced in unit multiples, keyed text fragments so that
 * char commits and word gaps are common, keyed command codes, occasional reset() calls, and about
 * 1 in 20 bad timestamps (non-finite, or earlier than the previous input unless `monotonic`).
 */
export function inputSequenceArb(options: InputSequenceOptions = {}): fc.Arbitrary<readonly EngineInput[]> {
  const scaleArb =
    typeof options.durationScale === 'number'
      ? fc.constant(options.durationScale)
      : (options.durationScale ?? fc.double({ min: 60, max: 600, noNaN: true }));
  return fc
    .tuple(fc.array(actionArb(options), { maxLength: options.maxActions ?? 80, size: 'max' }), scaleArb)
    .map(([actions, scale]) => buildInputs(actions, scale));
}

const ratioArb = fc.oneof(fc.double({ min: 0, max: 1, noNaN: true }), fc.constantFrom(0, 1));

/**
 * Inserts 0–3 ticks into every gap between neighbouring inputs [a, b] at a + r × (b − a), with
 * r ∈ [0, 1] including both ends, clamped so a tick never passes b. Gaps next to a reset, a
 * non-finite timestamp or a decreasing pair get no ticks.
 */
export function insertExtraTicks(inputs: readonly EngineInput[]): fc.Arbitrary<readonly EngineInput[]> {
  const gaps = Math.max(inputs.length - 1, 0);
  return fc
    .array(fc.array(ratioArb, { maxLength: 3 }), { minLength: gaps, maxLength: gaps })
    .map((ratiosPerGap) => {
      const result: EngineInput[] = [];
      inputs.forEach((input, i) => {
        result.push(input);
        const next = inputs[i + 1];
        const ratios = ratiosPerGap[i];
        if (next === undefined || ratios === undefined) return;
        const a = timeOf(input);
        const b = timeOf(next);
        if (a === null || b === null || a > b) return;
        for (const r of [...ratios].sort((x, y) => x - y)) {
          result.push({ type: 'tick', t: Math.min(b, Math.max(a, a + r * (b - a))) });
        }
      });
      return result;
    });
}
