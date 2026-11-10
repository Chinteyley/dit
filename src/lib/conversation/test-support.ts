/**
 * fast-check arbitraries, fakes and helpers shared by the conversation and controller tests
 * (design "Testing Strategy", Requirement 23.1 to 23.4). Test-only: never re-exported from
 * index.ts.
 */
import fc from 'fast-check';
import { trimWhitespace, type ExpansionClient, type ExpansionResult, type Turn } from '@/lib/expansion';
import {
  DEFAULT_INPUT_SETTINGS,
  SOURCE_KINDS,
  createManualScheduler,
  type Clock,
  type ManualScheduler,
  type PressEvent,
  type Unsubscribe,
} from '@/lib/input';
import {
  SUPPORTED_CHARACTERS,
  type CommandName,
  type DecoderState,
  type Engine,
  type EngineConfig,
  type EngineEvent,
  type EstimateSnapshot,
} from '@/lib/morse';
import type { AlarmHandler, UnknownPatternHandler } from './handlers';
import { INITIAL_SESSION, reduce, trimmedText } from './session';
import { DEFAULT_SETTINGS, RATE_MAX, RATE_MIN, WPM_MAX, WPM_MIN, type SettingsRecord } from './settings';
import type { HistoryRecord, KeyValueBackend } from './storage';
import {
  HISTORY_CAP,
  TEXT_MAX,
  type HydrateEntry,
  type SessionAction,
  type SessionState,
  type SessionTurn,
  type SuggestionSource,
} from './types';

/** Minimum fast-check runs for every conversation property. */
export const PROP_RUNS = 200;

// ---------------------------------------------------------------------------
// Characters and text

/** The 4 Whitespace characters. */
export const WHITESPACE_CHARS: readonly string[] = Object.freeze([' ', '\t', '\n', '\r']);

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];
const DIGITS = [...'0123456789'];
const PUNCTUATION = SUPPORTED_CHARACTERS.filter((ch) => !/^[a-z0-9]$/.test(ch));

/** One character of typed text: a-z, digits, Character_Table punctuation and the 4 Whitespace characters. */
export const textCharArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 12, arbitrary: fc.constantFrom(...LETTERS) },
  { weight: 2, arbitrary: fc.constantFrom(...DIGITS) },
  { weight: 2, arbitrary: fc.constantFrom(...PUNCTUATION) },
  { weight: 4, arbitrary: fc.constant(' ') },
  { weight: 1, arbitrary: fc.constantFrom('\t', '\n', '\r') },
);

/** Strings made only of Whitespace, 0 to `max` characters. */
export function arbWhitespace(max = 8): fc.Arbitrary<string> {
  return fc.string({ unit: fc.constantFrom(...WHITESPACE_CHARS), maxLength: max });
}

/**
 * 0 to 500 characters (or the given range) from textCharArb, biased to the lengths 0, 1, 499 and
 * 500 (the range ends) and to texts that end in a space.
 */
export function arbText(opts: { readonly min?: number; readonly max?: number } = {}): fc.Arbitrary<string> {
  const min = opts.min ?? 0;
  const max = opts.max ?? TEXT_MAX;
  const ends = [...new Set([min, Math.min(min + 1, max), Math.max(max - 1, min), max])];
  const length = fc.oneof(fc.constantFrom(...ends), fc.integer({ min, max }));
  const trailingSpace = fc.integer({ min: 0, max: 3 }).map((n) => n === 0);
  return fc
    .tuple(length, trailingSpace)
    .chain(([n, trailing]) =>
      fc
        .string({ unit: textCharArb, minLength: n, maxLength: n })
        .map((s) => (trailing && s.length > 0 ? `${s.slice(0, -1)} ` : s)),
    );
}

/** Keeps the length but replaces each space that would start the text or follow a space. */
export function toCurrentText(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw.charAt(i);
    out += ch === ' ' && (out === '' || out.endsWith(' ')) ? 'e' : ch;
  }
  return out;
}

/** A Current_Text that satisfies the spacing and length invariant (0 to 500 characters). */
export function arbCurrentText(opts: { readonly max?: number } = {}): fc.Arbitrary<string> {
  return arbText({ max: opts.max ?? TEXT_MAX }).map(toCurrentText);
}

/** Replaces the first character with 'a' when the text is blank, so it has a non-Whitespace character. */
function nonBlank(s: string): string {
  return trimWhitespace(s) === '' ? `a${s.slice(1)}` : s;
}

/** A displayable suggestion: 1 to 200 characters with at least one non-Whitespace character. */
export function arbSuggestionText(): fc.Arbitrary<string> {
  return fc
    .oneof({ weight: 6, arbitrary: arbText({ min: 1, max: 60 }) }, { weight: 1, arbitrary: arbText({ min: 190, max: 200 }) })
    .map((s) => trimWhitespace(nonBlank(s)) || 'a');
}

/** A Current_Pattern of 0 to `max` dots and dashes. */
export function arbPattern(max = 9): fc.Arbitrary<string> {
  return fc.string({ unit: fc.constantFrom('.', '-'), maxLength: max });
}

// ---------------------------------------------------------------------------
// States

export const roleArb: fc.Arbitrary<'speaker' | 'partner'> = fc.constantFrom('speaker', 'partner');
export const sourceArb: fc.Arbitrary<SuggestionSource> = fc.constantFrom('ai', 'on-device');

/** Trimmed Turn text of 1 to 500 characters, mostly short. */
export function arbTurnText(): fc.Arbitrary<string> {
  return fc
    .oneof({ weight: 8, arbitrary: arbText({ min: 1, max: 40 }) }, { weight: 1, arbitrary: arbText({ min: 495, max: 500 }) })
    .map((s) => trimWhitespace(nonBlank(s)) || 'a');
}

/** Turn counts biased to 0, 1, 199 and 200. */
const turnCountArb = fc.oneof(fc.constantFrom(0, 1, HISTORY_CAP - 1, HISTORY_CAP), fc.integer({ min: 0, max: HISTORY_CAP }));

/** 0 to 200 Turns with strictly increasing IDs, starting anywhere from 1 to 1,000. */
export function arbTurns(count: fc.Arbitrary<number> = turnCountArb): fc.Arbitrary<readonly SessionTurn[]> {
  return fc
    .tuple(
      count.chain((n) =>
        fc.array(fc.record({ role: roleArb, text: arbTurnText(), gap: fc.integer({ min: 1, max: 3 }) }), {
          minLength: n,
          maxLength: n,
        }),
      ),
      fc.integer({ min: 0, max: 999 }),
    )
    .map(([bodies, before]) => {
      let id = before;
      return bodies.map((body) => {
        id += body.gap;
        return { id, role: body.role, text: body.text };
      });
    });
}

interface SuggestionFields {
  readonly suggestions: readonly string[];
  readonly suggestionSource: SuggestionSource | null;
  readonly highlight: number | null;
}

/** 0 to 3 Suggestions (or the given range) with a matching source and an in-range Highlight. */
export function arbSuggestionFields(opts: { readonly min?: number; readonly max?: number } = {}): fc.Arbitrary<SuggestionFields> {
  return fc.integer({ min: opts.min ?? 0, max: opts.max ?? 3 }).chain((n): fc.Arbitrary<SuggestionFields> =>
    n === 0
      ? fc.constant({ suggestions: [], suggestionSource: null, highlight: null })
      : fc.record({
          suggestions: fc.array(arbSuggestionText(), { minLength: n, maxLength: n }),
          suggestionSource: sourceArb,
          highlight: fc.option(fc.integer({ min: 0, max: n - 1 }), { nil: null }),
        }),
  );
}

/**
 * States that satisfy every Session_State invariant, built directly so large Turn counts and
 * 500-character texts are cheap: 0 to 200 Turns, increasing IDs, nextTurnId above them, and
 * 0 to 3 Suggestions with a matching source and Highlight.
 */
export function arbStateDirect(
  opts: { readonly turns?: fc.Arbitrary<readonly SessionTurn[]>; readonly suggestions?: fc.Arbitrary<SuggestionFields> } = {},
): fc.Arbitrary<SessionState> {
  return fc
    .record({
      currentText: arbCurrentText(),
      currentPattern: arbPattern(),
      suggestionFields: opts.suggestions ?? arbSuggestionFields(),
      turns: opts.turns ?? arbTurns(),
      lastSpoken: fc.option(arbTurnText(), { nil: null }),
      idGap: fc.integer({ min: 0, max: 50 }),
    })
    .map(({ currentText, currentPattern, suggestionFields, turns, lastSpoken, idGap }) => {
      const maxId = turns.at(-1)?.id ?? 0;
      return {
        currentText,
        currentPattern,
        ...suggestionFields,
        turns,
        lastSpoken,
        nextTurnId: maxId + 1 + idGap,
      };
    });
}

// ---------------------------------------------------------------------------
// Actions

const COMMANDS: readonly CommandName[] = ['speak', 'next', 'backspace', 'sos'];

export const engineEventArb: fc.Arbitrary<EngineEvent> = fc.oneof(
  { weight: 6, arbitrary: fc.constantFrom('.', '-').map((symbol): EngineEvent => ({ type: 'symbol', symbol })) },
  { weight: 10, arbitrary: fc.constantFrom(...SUPPORTED_CHARACTERS).map((char): EngineEvent => ({ type: 'char', char })) },
  { weight: 4, arbitrary: fc.constant<EngineEvent>({ type: 'space' }) },
  { weight: 1, arbitrary: arbPattern(10).filter((p) => p.length > 0).map((pattern): EngineEvent => ({ type: 'unknown', pattern })) },
  { weight: 3, arbitrary: fc.constant<EngineEvent>({ type: 'command', command: 'backspace' }) },
  { weight: 3, arbitrary: fc.constant<EngineEvent>({ type: 'command', command: 'next' }) },
  { weight: 2, arbitrary: fc.constant<EngineEvent>({ type: 'command', command: 'speak' }) },
  { weight: 1, arbitrary: fc.constant<EngineEvent>({ type: 'command', command: 'sos' }) },
);

/** Every Engine_Event variant with equal weight per kind (for single-event properties). */
export const anyEngineEventArb: fc.Arbitrary<EngineEvent> = fc.oneof(
  fc.constantFrom('.', '-').map((symbol): EngineEvent => ({ type: 'symbol', symbol })),
  fc.constantFrom(...SUPPORTED_CHARACTERS).map((char): EngineEvent => ({ type: 'char', char })),
  fc.constant<EngineEvent>({ type: 'space' }),
  arbPattern(10).filter((p) => p.length > 0).map((pattern): EngineEvent => ({ type: 'unknown', pattern })),
  fc.constantFrom(...COMMANDS).map((command): EngineEvent => ({ type: 'command', command })),
);

/** Partner_Line text: Whitespace-only, short, or over 500 characters with Whitespace around it. */
export const partnerLineTextArb: fc.Arbitrary<string> = fc.oneof(
  arbWhitespace(),
  arbText({ min: 0, max: 40 }),
  fc
    .tuple(arbWhitespace(3), arbText({ min: 498, max: 700 }), arbWhitespace(3))
    .map(([before, body, after]) => before + body + after),
);

/** Partner_Pick indexes: small integers around the valid range, and any double (NaN, ±Infinity, fractions). */
export const pickIndexArb: fc.Arbitrary<number> = fc.oneof(fc.integer({ min: -2, max: 4 }), fc.double());

const hydrateRoleArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: roleArb },
  { weight: 1, arbitrary: fc.constantFrom('Speaker', 'PARTNER', '', 'system', 'assistant') },
  { weight: 1, arbitrary: fc.string({ maxLength: 8 }) },
);

const hydrateTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: arbText({ min: 0, max: 30 }) },
  { weight: 1, arbitrary: arbWhitespace() },
  { weight: 1, arbitrary: arbText({ min: 495, max: 520 }) },
);

export const hydrateEntryArb: fc.Arbitrary<HydrateEntry> = fc.record({ role: hydrateRoleArb, text: hydrateTextArb });

/** 0 to 250 entries of mixed valid and invalid roles and texts, often near the 200 cap. */
export const hydrateEntriesArb: fc.Arbitrary<readonly HydrateEntry[]> = fc.oneof(
  { weight: 4, arbitrary: fc.array(hydrateEntryArb, { maxLength: 12 }) },
  { weight: 1, arbitrary: fc.array(hydrateEntryArb, { minLength: 190, maxLength: 250, size: 'max' }) },
);

/** How a stale Suggestions_Received text differs from the current Trimmed_Text. */
export type NearMiss = 'case' | 'inner' | 'outer';

/** A text that differs from `t` only in case or Whitespace (never equal to `t`). */
export function nearMiss(t: string, kind: NearMiss): string {
  if (kind === 'case') {
    for (let i = 0; i < t.length; i++) {
      const ch = t.charAt(i);
      const flipped = ch === ch.toLowerCase() ? ch.toUpperCase() : ch.toLowerCase();
      if (flipped !== ch) return t.slice(0, i) + flipped + t.slice(i + 1);
    }
  }
  if (kind === 'inner') {
    const space = t.indexOf(' ');
    if (space > 0) return `${t.slice(0, space)}  ${t.slice(space + 1)}`;
    if (t.length >= 2) return `${t.slice(0, 1)} ${t.slice(1)}`;
  }
  return ` ${t}`;
}

/**
 * One generated step. Every action is fixed at generation time except Suggestions_Received,
 * whose text is resolved against the state it is applied to (70% the current Trimmed_Text,
 * otherwise a near miss), so it can answer the current text.
 */
export type ActionStep =
  | { readonly kind: 'fixed'; readonly action: SessionAction }
  | {
      readonly kind: 'suggestions';
      readonly fresh: boolean;
      readonly miss: NearMiss;
      readonly suggestions: readonly string[];
      readonly source: SuggestionSource;
    };

const fixed = (action: SessionAction): ActionStep => ({ kind: 'fixed', action });

export const actionStepArb: fc.Arbitrary<ActionStep> = fc.oneof(
  { weight: 30, arbitrary: engineEventArb.map((event) => fixed({ type: 'engine', event })) },
  {
    weight: 5,
    arbitrary: fc
      .record({
        fresh: fc.integer({ min: 1, max: 10 }).map((n) => n <= 7),
        miss: fc.constantFrom<NearMiss>('case', 'inner', 'outer'),
        suggestions: fc.array(arbSuggestionText(), { maxLength: 5 }),
        source: sourceArb,
      })
      .map((step): ActionStep => ({ kind: 'suggestions', ...step })),
  },
  { weight: 2, arbitrary: partnerLineTextArb.map((text) => fixed({ type: 'partner-line', text })) },
  { weight: 2, arbitrary: pickIndexArb.map((index) => fixed({ type: 'partner-pick', index })) },
  { weight: 1, arbitrary: fc.constant(fixed({ type: 'clear-history' })) },
  { weight: 1, arbitrary: hydrateEntriesArb.map((turns) => fixed({ type: 'hydrate', turns })) },
);

/** Turns a generated step into the Session_Action it means in `state`. */
export function resolveStep(step: ActionStep, state: SessionState): SessionAction {
  if (step.kind === 'fixed') return step.action;
  const current = trimmedText(state);
  return {
    type: 'suggestions',
    result: {
      text: step.fresh ? current : nearMiss(current, step.miss),
      suggestions: step.suggestions,
      source: step.source,
    },
  };
}

/** A Session_Action of any kind for `state`; Suggestions_Received matches its Trimmed_Text 70% of the time. */
export function arbAction(state: SessionState): fc.Arbitrary<SessionAction> {
  return actionStepArb.map((step) => resolveStep(step, state));
}

/** Resolves steps by folding them over `from` with the reducer. */
export function resolveSteps(from: SessionState, steps: readonly ActionStep[]): readonly SessionAction[] {
  const actions: SessionAction[] = [];
  let state = from;
  for (const step of steps) {
    const action = resolveStep(step, state);
    actions.push(action);
    state = reduce(state, action).state;
  }
  return actions;
}

/** Sequences of up to `max` actions of every kind, resolved as a stateful fold from `from`. */
export function arbActions(opts: {
  readonly max: number;
  readonly min?: number;
  readonly from?: SessionState;
}): fc.Arbitrary<readonly SessionAction[]> {
  return fc
    .array(actionStepArb, { minLength: opts.min ?? 0, maxLength: opts.max, size: 'max' })
    .map((steps) => resolveSteps(opts.from ?? INITIAL_SESSION, steps));
}

/** Applies actions in order and returns the final state. */
export function foldActions(from: SessionState, actions: readonly SessionAction[]): SessionState {
  let state = from;
  for (const action of actions) state = reduce(state, action).state;
  return state;
}

/** States reached by folding up to 300 generated actions over INITIAL_SESSION. */
export function arbReachableState(): fc.Arbitrary<SessionState> {
  return arbActions({ max: 300 }).map((actions) => foldActions(INITIAL_SESSION, actions));
}

/** Direct or reachable states. */
export function arbState(): fc.Arbitrary<SessionState> {
  return fc.oneof(arbStateDirect(), arbReachableState());
}

/** A start state and a sequence of up to `max` actions resolved against it. */
export function arbStateAndActions(max: number): fc.Arbitrary<{
  readonly state: SessionState;
  readonly actions: readonly SessionAction[];
}> {
  return arbState().chain((state) => arbActions({ max, from: state }).map((actions) => ({ state, actions })));
}

// ---------------------------------------------------------------------------
// Settings

/** Doubles in [min, max] (no NaN, no -0), biased to both ends and to tenths. */
function arbDoubleIn(min: number, max: number): fc.Arbitrary<number> {
  return fc.oneof(
    fc.constantFrom(min, max),
    fc.integer({ min: Math.ceil(min * 10), max: Math.floor(max * 10) }).map((n) => n / 10),
    fc.double({ min, max, noNaN: true }),
  );
}

/** Valid Input_Layer settings: minimum presses inside each kind's range and 0 < open < close ≤ 1. */
export const arbInputSettings: fc.Arbitrary<SettingsRecord['input']> = fc
  .record({
    keyboard: fc.integer({ min: 0, max: 500 }),
    switch: fc.integer({ min: 0, max: 500 }),
    pointer: fc.integer({ min: 0, max: 500 }),
    blink: fc.integer({ min: 50, max: 2000 }),
    close: fc.oneof(fc.constant(1), fc.double({ min: 0.02, max: 1, noNaN: true })),
    openShare: fc.double({ min: 0.01, max: 0.99, noNaN: true }),
  })
  .map(({ keyboard, switch: switchMin, pointer, blink, close, openShare }) => ({
    minPressDuration: { keyboard, switch: switchMin, pointer, blink },
    closeThreshold: close,
    openThreshold: close * openShare,
  }))
  .filter((input) => input.openThreshold > 0 && input.openThreshold < input.closeThreshold);

/** Valid Settings_Records. */
export function arbSettingsRecord(): fc.Arbitrary<SettingsRecord> {
  return fc.record({
    v: fc.constant(1 as const),
    voiceURI: fc.option(fc.oneof(fc.constantFrom('com.apple.voice.compact.en-US.Samantha', 'Google UK English Female'), fc.string({ minLength: 1, maxLength: 30 })), { nil: null }),
    speechRate: arbDoubleIn(RATE_MIN, RATE_MAX),
    flip: fc.boolean(),
    startingWpm: arbDoubleIn(WPM_MIN, WPM_MAX),
    adaptive: fc.boolean(),
    switchKey: fc.option(fc.constantFrom('KeyJ', 'F13', 'ShiftLeft', 'AudioVolumeUp'), { nil: null }),
    input: arbInputSettings,
  });
}

// ---------------------------------------------------------------------------
// Storage

/** History_Record Turn text: any 1 to 500 characters (TurnSchema does not trim), mostly short. */
const storedTurnTextArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 6, arbitrary: arbTurnText() },
  { weight: 1, arbitrary: arbText({ min: 1, max: 500 }) },
);

/** Valid History_Records with 0 to 200 Turns, or 201 to 250 with `overCap`. */
export function arbHistoryRecord(opts: { readonly overCap?: boolean } = {}): fc.Arbitrary<HistoryRecord> {
  const count = opts.overCap === true ? fc.integer({ min: HISTORY_CAP + 1, max: 250 }) : turnCountArb;
  return count.chain((n) =>
    fc
      .array(fc.record({ role: roleArb, text: storedTurnTextArb }), { minLength: n, maxLength: n })
      .map((turns): HistoryRecord => ({ v: 1, turns })),
  );
}

/** Stored strings that are valid for neither record: invalid JSON and JSON of the wrong shape. */
export function arbStoredJunk(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constantFrom('', '{', '{"v":1,', 'undefined', 'NaN', "{'v':1}", '[1,2', 'nul'),
    fc.string({ maxLength: 12 }).filter((s) => {
      try {
        JSON.parse(s);
        return false;
      } catch {
        return true;
      }
    }),
    fc.constantFrom('null', 'true', '42', '"text"', '[]', '{}', '{"v":2,"turns":[]}', '{"v":1}', '{"turns":[]}'),
    fc.jsonValue({ maxDepth: 2 }).map((value) => JSON.stringify(value) ?? 'null'),
  );
}

export interface StoredCase<T> {
  /** The stored string, or null when the key is missing. */
  readonly raw: string | null;
  /** What loading it must give. */
  readonly expected: T;
}

const invalidTurnArb = fc.oneof(
  fc.record({ role: fc.constantFrom('system', 'Speaker', ''), text: fc.constant('hi') }),
  fc.record({ role: roleArb, text: fc.constant('') }),
  fc.record({ role: roleArb, text: fc.constant('x'.repeat(501)) }),
  fc.record({ role: roleArb, text: fc.constant(42) }),
);

/** Stored History_Record strings with the turns that loading must give (Req 16.4, 16.6, 16.7). */
export function arbStoredHistory(): fc.Arbitrary<StoredCase<HistoryRecord['turns']>> {
  const empty: HistoryRecord['turns'] = [];
  return fc.oneof(
    fc.constant({ raw: null, expected: empty }),
    arbStoredJunk().map((raw) => ({ raw, expected: empty })),
    arbSettingsRecord().map((record) => ({ raw: JSON.stringify(record), expected: empty })),
    fc
      .tuple(arbHistoryRecord(), invalidTurnArb, fc.nat())
      .map(([record, bad, at]) => {
        const turns: unknown[] = [...record.turns];
        turns.splice(at % (turns.length + 1), 0, bad);
        return { raw: JSON.stringify({ v: 1, turns }), expected: empty };
      }),
    fc
      .oneof(arbHistoryRecord(), arbHistoryRecord({ overCap: true }))
      .map((record) => ({ raw: JSON.stringify(record), expected: record.turns.slice(-HISTORY_CAP) })),
  );
}

/** Values outside the Speech_Rate or Starting_WPM range, or not numbers. */
const outOfRangeArb = (min: number, max: number): fc.Arbitrary<unknown> =>
  fc.oneof(
    fc.double({ min: -100, max: min - 0.001, noNaN: true }),
    fc.double({ min: max + 0.001, max: 100, noNaN: true }),
    fc.constantFrom('1', null, true, Number.NaN),
  );

/** Stored Settings_Record strings with the record that loading must give (Req 16.7, 16.11, 17.10). */
export function arbStoredSettings(): fc.Arbitrary<StoredCase<SettingsRecord>> {
  const defaults = (raw: string | null): StoredCase<SettingsRecord> => ({ raw, expected: DEFAULT_SETTINGS });
  return fc.oneof(
    fc.constant(defaults(null)),
    arbStoredJunk().map(defaults),
    arbHistoryRecord().map((record) => defaults(JSON.stringify(record))),
    fc
      .tuple(arbSettingsRecord(), fc.constantFrom('speechRate', 'startingWpm'))
      .chain(([record, key]) =>
        (key === 'speechRate' ? outOfRangeArb(RATE_MIN, RATE_MAX) : outOfRangeArb(WPM_MIN, WPM_MAX)).map((bad) =>
          defaults(JSON.stringify({ ...record, [key]: bad })),
        ),
      ),
    // One bad minimum press: only that value falls back to its default.
    fc
      .tuple(arbSettingsRecord(), fc.constantFrom(...SOURCE_KINDS), fc.constantFrom(-1, 2001, 'x', null))
      .map(([record, kind, bad]) => ({
        raw: JSON.stringify({ ...record, input: { ...record.input, minPressDuration: { ...record.input.minPressDuration, [kind]: bad } } }),
        expected: {
          ...record,
          input: {
            ...record.input,
            minPressDuration: { ...record.input.minPressDuration, [kind]: DEFAULT_INPUT_SETTINGS.minPressDuration[kind] },
          },
        },
      })),
    // A bad close threshold with an open threshold below the default close: only close falls back.
    fc
      .tuple(arbSettingsRecord(), fc.double({ min: 0.01, max: 0.49, noNaN: true }), fc.constantFrom(0, 1.5, -1, 'x'))
      .map(([record, open, bad]) => ({
        raw: JSON.stringify({ ...record, input: { ...record.input, closeThreshold: bad, openThreshold: open } }),
        expected: {
          ...record,
          input: { ...record.input, closeThreshold: DEFAULT_INPUT_SETTINGS.closeThreshold, openThreshold: open },
        },
      })),
    // Input settings that are not an object at all.
    arbSettingsRecord().map((record) => ({
      raw: JSON.stringify({ ...record, input: 'fast' }),
      expected: { ...record, input: DEFAULT_INPUT_SETTINGS },
    })),
    arbSettingsRecord().map((record) => ({ raw: JSON.stringify(record), expected: record })),
  );
}

/** A Map-backed backend whose getItem and/or setItem throw, as disabled or full localStorage does. */
export function throwingBackend(
  opts: { readonly get?: boolean; readonly set?: boolean; readonly initial?: Readonly<Record<string, string>> } = {},
): KeyValueBackend & { readonly writes: readonly (readonly [string, string])[] } {
  const items = new Map<string, string>(Object.entries(opts.initial ?? {}));
  const writes: (readonly [string, string])[] = [];
  return {
    writes,
    getItem(key) {
      if (opts.get === true) throw new Error('storage read blocked');
      return items.get(key) ?? null;
    },
    setItem(key, value) {
      if (opts.set === true) throw new Error('storage full');
      writes.push([key, value]);
      items.set(key, value);
    },
    removeItem(key) {
      items.delete(key);
    },
  };
}

// ---------------------------------------------------------------------------
// Controller fakes (task 9.1)

export type EngineCall =
  | { readonly kind: 'press' | 'release' | 'tick'; readonly t: number }
  | { readonly kind: 'reset' };

/** Events returned by successive press/release/tick calls, shared by every engine of one factory. */
export type EngineScript = EngineEvent[][];

export interface FakeEngine extends Engine {
  readonly config: EngineConfig;
  /** Every call, in order. */
  readonly calls: readonly EngineCall[];
  /** What nextDeadline() returns. reset() clears it, and a tick at or after it consumes it, as a real Engine does. */
  deadline: number | null;
  /** Number of reset() calls. */
  readonly resets: number;
  /** Called with the t of each tick, before the scripted events are returned. */
  onTick: ((t: number) => void) | null;
}

const FAKE_ESTIMATES: EstimateSnapshot = Object.freeze({
  dotEstimate: 200,
  dashEstimate: 600,
  dotDashThreshold: 400,
  letterGapThreshold: 400,
  wordGapThreshold: 900,
});

/** A scripted Engine: each press/release/tick returns the next entry of `script` (or nothing). */
export function createFakeEngine(config: EngineConfig = {}, script: EngineScript = []): FakeEngine {
  const calls: EngineCall[] = [];
  let resets = 0;
  const next = (): readonly EngineEvent[] => script.shift() ?? [];
  const fake: FakeEngine = {
    config,
    calls,
    deadline: null,
    get resets() {
      return resets;
    },
    onTick: null,
    mode: config.mode === 'fixed' ? 'fixed' : 'adaptive',
    press(t) {
      calls.push({ kind: 'press', t });
      return next();
    },
    release(t) {
      calls.push({ kind: 'release', t });
      return next();
    },
    tick(t) {
      calls.push({ kind: 'tick', t });
      fake.onTick?.(t);
      if (fake.deadline !== null && t >= fake.deadline) fake.deadline = null;
      return next();
    },
    reset() {
      calls.push({ kind: 'reset' });
      resets += 1;
      fake.deadline = null;
    },
    nextDeadline: () => fake.deadline,
    estimates: () => FAKE_ESTIMATES,
    snapshot: (): DecoderState => ({
      mode: fake.mode,
      alpha: 0.15,
      estimates: { dotEstimate: FAKE_ESTIMATES.dotEstimate, dashEstimate: FAKE_ESTIMATES.dashEstimate },
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

/** Builds FakeEngines that share one script, and remembers every engine it built (newest last). */
export function fakeEngineFactory(): {
  readonly create: (config: EngineConfig) => FakeEngine;
  readonly engines: readonly FakeEngine[];
  readonly script: EngineScript;
  current(): FakeEngine;
} {
  const engines: FakeEngine[] = [];
  const script: EngineScript = [];
  return {
    create(config) {
      const engine = createFakeEngine(config, script);
      engines.push(engine);
      return engine;
    },
    engines,
    script,
    current() {
      const engine = engines.at(-1);
      if (engine === undefined) throw new Error('no engine was created');
      return engine;
    },
  };
}

export interface FakeClient extends ExpansionClient {
  /** Every update(text, context) call, in order. */
  readonly updates: readonly { readonly text: string; readonly context: readonly Turn[] }[];
  readonly disposed: boolean;
  /** Delivers a result to the controller, as if a request resolved. Nothing resolves on its own. */
  deliver(result: ExpansionResult): void;
  /** Pass as the controller's createClient. */
  readonly create: (onResult: (result: ExpansionResult) => void) => ExpansionClient;
}

export function createFakeClient(): FakeClient {
  const updates: { readonly text: string; readonly context: readonly Turn[] }[] = [];
  let onResult: ((result: ExpansionResult) => void) | null = null;
  let disposed = false;
  const fake: FakeClient = {
    updates,
    get disposed() {
      return disposed;
    },
    update(text, context) {
      updates.push({ text, context: context.map((turn) => ({ role: turn.role, text: turn.text })) });
    },
    dispose() {
      disposed = true;
    },
    deliver(result) {
      onResult?.(result);
    },
    create(listener) {
      onResult = listener;
      return fake;
    },
  };
  return fake;
}

export interface FakeAlarmHandler extends AlarmHandler {
  /** What isActive() reports. Setting it directly emits nothing; use setActive() to notify. */
  active: boolean;
  /** When true, start() throws (after counting the call) and the alarm stays inactive. */
  throwOnStart: boolean;
  readonly starts: number;
  /** Press_Events routed to the alarm, in order. */
  readonly presses: readonly PressEvent[];
  /** Sets isActive() and notifies onActiveChange listeners when it changes. */
  setActive(active: boolean): void;
  listenerCount(): number;
}

export function createFakeAlarmHandler(): FakeAlarmHandler {
  const presses: PressEvent[] = [];
  const listeners = new Set<(active: boolean) => void>();
  let starts = 0;
  const fake: FakeAlarmHandler = {
    active: false,
    throwOnStart: false,
    get starts() {
      return starts;
    },
    presses,
    start() {
      starts += 1;
      if (fake.throwOnStart) throw new Error('alarm could not start');
      fake.setActive(true);
    },
    isActive: () => fake.active,
    handlePress(event) {
      presses.push(event);
    },
    onActiveChange(listener): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setActive(active) {
      if (fake.active === active) return;
      fake.active = active;
      for (const listener of [...listeners]) listener(active);
    },
    listenerCount: () => listeners.size,
  };
  return fake;
}

export interface FakeUnknownPatternHandler extends UnknownPatternHandler {
  readonly patterns: readonly string[];
  throwOnHandle: boolean;
}

export function createFakeUnknownPatternHandler(): FakeUnknownPatternHandler {
  const patterns: string[] = [];
  const fake: FakeUnknownPatternHandler = {
    patterns,
    throwOnHandle: false,
    handle(pattern) {
      patterns.push(pattern);
      if (fake.throwOnHandle) throw new Error('hint failed');
    },
  };
  return fake;
}

export interface ScheduledTimer {
  readonly due: number;
  readonly delay: number;
}

/** A manual scheduler (timers due from the clock) that also reports its live timers. */
export interface InspectableScheduler extends ManualScheduler {
  /** Live timers (scheduled, not fired, not cancelled), in scheduling order. */
  live(): readonly ScheduledTimer[];
  /** Every schedule() call, in order. */
  readonly log: readonly ScheduledTimer[];
}

export function createInspectableScheduler(clock: Clock): InspectableScheduler {
  const inner = createManualScheduler(clock);
  const live = new Map<number, ScheduledTimer>();
  const log: ScheduledTimer[] = [];
  let nextId = 0;
  return {
    schedule(delayMs, fn) {
      const id = nextId++;
      const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
      const timer = { due: clock() + delay, delay };
      log.push(timer);
      live.set(id, timer);
      const cancel = inner.schedule(delayMs, () => {
        live.delete(id);
        fn();
      });
      return () => {
        live.delete(id);
        cancel();
      };
    },
    runDue: (now) => inner.runDue(now),
    pending: () => inner.pending(),
    live: () => [...live.values()],
    log,
  };
}

/** Freezes a value and everything reachable from it. */
export function deepFreeze<T>(value: T, seen: WeakSet<object> = new WeakSet()): T {
  if (typeof value !== 'object' || value === null || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key), seen);
  Object.freeze(value);
  return value;
}
