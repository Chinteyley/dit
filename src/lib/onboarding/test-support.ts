/**
 * fast-check arbitraries and helpers for the onboarding tests (design "Testing Strategy",
 * "Generators"). Test-only: never re-exported from index.ts.
 */
import fc from 'fast-check';
import type { SourceStatus } from '@/lib/input';
import { CHARACTER_TABLE, SUPPORTED_CHARACTERS, calibrate, type CommandName } from '@/lib/morse';
import type { CheatSheetAction, CheatSheetContext, CheatSheetState } from './cheat-sheet-state';
import { PRACTICE_PRESSES, initialFirstRun, initialRerun, onboardingEffects, onboardingStep } from './flow';
import { COMMAND_ORDER } from './legend-model';
import type { Rect } from './placement';
import { serializeOnboardingRecord, type OnboardingRecord } from './record';
import type { InputChoice, OnboardingAction, OnboardingEffect, OnboardingState } from './types';

/** Minimum fast-check runs for every onboarding property. */
export const PROP_RUNS = 200;
/** Runs for the Onboarding_Reducer properties (tasks 9.6 to 9.13). */
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
// Codes and tables (tasks 6.3 and 7.3)

const symbolArb = fc.constantFrom('.', '-');

/** A code over {., -} with `minLength` to `maxLength` symbols (default 1 to 10). */
export function arbCode(opts: { readonly minLength?: number; readonly maxLength?: number } = {}): fc.Arbitrary<string> {
  return fc.string({ unit: symbolArb, minLength: opts.minLength ?? 1, maxLength: opts.maxLength ?? 10 });
}

/** 4 distinct codes of 1 to 9 symbols mapped to the 4 command names, in random insertion order. */
export function arbCommandTable(): fc.Arbitrary<Readonly<Record<string, CommandName>>> {
  return fc
    .tuple(
      fc.uniqueArray(arbCode({ maxLength: 9 }), { minLength: 4, maxLength: 4 }),
      fc.shuffledSubarray([...COMMAND_ORDER], { minLength: 4, maxLength: 4 }),
    )
    .map(([codes, names]) => Object.fromEntries(codes.map((code, i) => [code, names[i] ?? 'speak'])));
}

/** Characters outside the real table, used as the optional key whose code collides with a command. */
const COLLISION_KEYS = ['&', '$', ';', '_', '#'] as const;

/**
 * A Character_Table that permutes the real codes across the 49 real keys, optionally adds `+` and
 * a key whose code equals one of `commands`' codes, each at a random position in table order.
 */
export function arbCharTable(
  commands: Readonly<Record<string, CommandName>>,
): fc.Arbitrary<Readonly<Record<string, string>>> {
  const realCodes = SUPPORTED_CHARACTERS.map((ch) => CHARACTER_TABLE[ch] ?? '');
  const commandCodes = Object.keys(commands);
  const extraArb = (key: string, code: fc.Arbitrary<string>): fc.Arbitrary<readonly [string, string] | null> =>
    fc.option(code.map((c) => [key, c] as const), { nil: null });
  return fc
    .record({
      codes: fc.shuffledSubarray(realCodes, { minLength: realCodes.length, maxLength: realCodes.length }),
      plus: extraArb('+', fc.oneof(fc.constant('.-.-.'), arbCode())),
      collision:
        commandCodes.length === 0
          ? fc.constant(null)
          : fc
              .tuple(fc.constantFrom(...COLLISION_KEYS), fc.constantFrom(...commandCodes))
              .chain(([key, code]) => extraArb(key, fc.constant(code))),
      plusAt: fc.nat({ max: SUPPORTED_CHARACTERS.length }),
      collisionAt: fc.nat({ max: SUPPORTED_CHARACTERS.length + 1 }),
    })
    .map(({ codes, plus, collision, plusAt, collisionAt }) => {
      const entries: (readonly [string, string])[] = SUPPORTED_CHARACTERS.map((ch, i) => [ch, codes[i] ?? ''] as const);
      if (plus !== null) entries.splice(plusAt, 0, plus);
      if (collision !== null) entries.splice(collisionAt, 0, collision);
      return Object.fromEntries(entries);
    });
}

// ---------------------------------------------------------------------------
// Cheat_Sheet state (task 8.2)

export interface CheatSheetRunStep {
  readonly action: CheatSheetAction;
  readonly ctx: CheatSheetContext;
}

const cheatSheetActionArb: fc.Arbitrary<CheatSheetAction> = fc.oneof(
  { weight: 3, arbitrary: arbCode().map((pattern): CheatSheetAction => ({ type: 'unknown', pattern })) },
  { weight: 2, arbitrary: fc.constant<CheatSheetAction>({ type: 'partner-open' }) },
  { weight: 3, arbitrary: fc.constant<CheatSheetAction>({ type: 'char-committed' }) },
  { weight: 2, arbitrary: fc.constant<CheatSheetAction>({ type: 'close' }) },
  { weight: 2, arbitrary: fc.nat({ max: 100 }).map((page): CheatSheetAction => ({ type: 'page', page })) },
);

/** 0 to 200 actions, each with random onboardingOpen and alarmActive flags (mostly both false). */
export function arbCheatSheetRun(opts: { readonly max?: number } = {}): fc.Arbitrary<readonly CheatSheetRunStep[]> {
  const flag = fc.oneof({ weight: 3, arbitrary: fc.constant(false) }, { weight: 1, arbitrary: fc.constant(true) });
  return fc.array(
    fc.record({ action: cheatSheetActionArb, ctx: fc.record({ onboardingOpen: flag, alarmActive: flag }) }),
    { maxLength: opts.max ?? 200, size: 'max' },
  );
}

/** The reference model of Property 16, written independently of cheatSheetStep. */
export function referenceSheet(steps: readonly CheatSheetRunStep[]): readonly CheatSheetState[] {
  let open = false;
  let reason: CheatSheetState['reason'] = null;
  let pattern: string | null = null;
  let page: number | undefined;
  const states: CheatSheetState[] = [];
  const close = (): void => {
    open = false;
    reason = null;
    pattern = null;
    page = undefined;
  };
  for (const { action, ctx } of steps) {
    if (!ctx.alarmActive || action.type === 'char-committed') {
      if (action.type === 'unknown' && !ctx.onboardingOpen) {
        if (open && action.pattern === '......') page = (page ?? 0) + 1;
        if (!open) reason = 'unknown';
        open = true;
        pattern = action.pattern;
      } else if (action.type === 'partner-open') {
        if (!open) pattern = null;
        open = true;
        reason = 'partner';
      } else if (action.type === 'page' && open) {
        if (action.page !== (page ?? 0)) page = action.page;
      } else if (action.type === 'char-committed' && open) {
        close();
      } else if (action.type === 'close') {
        close();
      }
    }
    states.push({ open, reason, pattern, ...(page === undefined ? {} : { page }) });
  }
  return states;
}

// ---------------------------------------------------------------------------
// Panel placement (task 8.5)

/** A rectangle with integer or fractional CSS pixel values. */
export function arbRect(bounds: { readonly maxWidth: number; readonly maxHeight: number }): fc.Arbitrary<Rect> {
  return fc.record({
    top: fc.double({ min: -bounds.maxHeight, max: bounds.maxHeight, noNaN: true }),
    left: fc.double({ min: -bounds.maxWidth, max: bounds.maxWidth, noNaN: true }),
    width: fc.double({ min: 1, max: bounds.maxWidth, noNaN: true }),
    height: fc.double({ min: 1, max: bounds.maxHeight, noNaN: true }),
  });
}

export interface PlacementInput {
  readonly viewport: Rect;
  readonly keying: Rect;
  readonly minSize: { readonly width: number; readonly height: number };
}

/**
 * Viewports from 320 × 320 to 3840 × 2160 at the origin, Keying_Surfaces that intersect the
 * viewport (often partly off-screen, often full-width bands like the real layout) and panel
 * minimum sizes from 1 px up to the whole viewport.
 */
export function arbPlacementInput(): fc.Arbitrary<PlacementInput> {
  return fc
    .record({ width: fc.integer({ min: 320, max: 3840 }), height: fc.integer({ min: 320, max: 2160 }) })
    .chain(({ width, height }) => {
      const viewport: Rect = { top: 0, left: 0, width, height };
      const keyingArb = fc.oneof(
        arbRect({ maxWidth: width, maxHeight: height }),
        // A full-width band, as in the one-column layout.
        fc
          .record({ top: fc.integer({ min: -height, max: height - 1 }), height: fc.integer({ min: 44, max: height }) })
          .map(({ top, height: h }) => ({ top, left: 0, width, height: h })),
      );
      return fc.record({
        viewport: fc.constant(viewport),
        keying: keyingArb.filter(
          (k) => k.left < width && k.left + k.width > 0 && k.top < height && k.top + k.height > 0,
        ),
        minSize: fc.record({
          width: fc.oneof(fc.integer({ min: 1, max: Math.min(400, width) }), fc.integer({ min: 1, max: width })),
          height: fc.oneof(fc.integer({ min: 1, max: Math.min(300, height) }), fc.integer({ min: 1, max: height })),
        }),
      });
    });
}

// ---------------------------------------------------------------------------
// Onboarding_Reducer (task 9.5)

export const INPUT_CHOICES: readonly InputChoice[] = Object.freeze(['key-tap', 'switch', 'blink']);
export const SOURCE_STATUSES: readonly SourceStatus[] = Object.freeze([
  'off',
  'starting',
  'active',
  'face-lost',
  'permission-denied',
  'no-camera',
  'unsupported',
  'error',
]);

const statusArb: fc.Arbitrary<SourceStatus> = fc.constantFrom(...SOURCE_STATUSES);

/** A first-run state, or a rerun for every Input_Choice and blink status. */
export function arbInitialOnboardingState(): fc.Arbitrary<OnboardingState> {
  return fc.oneof(
    fc.constant(null).map(() => initialFirstRun()),
    fc.tuple(fc.constantFrom(...INPUT_CHOICES), statusArb).map(([choice, status]) => initialRerun(choice, status)),
  );
}

/** The Calibration held by a Practice_Step result, or null. */
export function heldCalibrationOf(s: OnboardingState): ReturnType<typeof calibrate> | null {
  return s.result.kind === 'none' ? null : s.result.calibration;
}

const retryable = (status: SourceStatus): boolean =>
  status === 'permission-denied' || status === 'no-camera' || status === 'error';

/**
 * The test's own model of which actions are valid in a state (the design's reducer table),
 * written apart from flow.ts so Property 23 does not trust the reducer's guards.
 */
export function isValidAction(s: OnboardingState, a: OnboardingAction): boolean {
  const cancel = a.type === 'cancel' && s.origin === 'rerun';
  switch (s.step) {
    case 'input':
      switch (a.type) {
        case 'choose':
        case 'use-key-tap':
          return true;
        case 'switch-result':
          return s.switchPhase.kind === 'armed';
        case 'switch-retry':
          return s.switchPhase.kind === 'failed';
        case 'camera-on':
          return (
            s.selected === 'blink' &&
            (s.blinkPhase.kind === 'explained' || (s.blinkPhase.kind === 'started' && retryable(s.blinkPhase.status)))
          );
        case 'blink-status':
          return s.selected === 'blink' && s.blinkPhase.kind === 'started';
        case 'continue':
          return s.inputChoice !== null;
        default:
          return cancel;
      }
    case 'practice':
      switch (a.type) {
        case 'press':
          return s.result.kind === 'none' && (a.kind === 'down' ? s.heldDownT === null && s.durations.length < PRACTICE_PRESSES : s.heldDownT !== null);
        case 'use-default':
          return true;
        case 'practice-again':
          return heldCalibrationOf(s) !== null;
        case 'use-this-speed':
          return s.result.kind === 'measured';
        case 'continue':
          return s.result.kind === 'default';
        default:
          return cancel;
      }
    case 'legend':
      return a.type === 'start' || cancel;
    default:
      return false;
  }
}

/** One generated step: valid (about 80 %) or invalid, which candidate, the clock step and payloads. */
export interface ActionPick {
  readonly valid: boolean;
  readonly which: number;
  /** Added to the clock before a press action: 0 to 3000 ms, so durations range 0 to 3000 ms. */
  readonly dt: number;
  readonly status: SourceStatus;
  readonly learned: boolean;
  readonly code: string;
}

export const actionPickArb: fc.Arbitrary<ActionPick> = fc.record({
  valid: fc.oneof({ weight: 4, arbitrary: fc.constant(true) }, { weight: 1, arbitrary: fc.constant(false) }),
  which: fc.nat({ max: 1_000 }),
  dt: fc.oneof({ weight: 1, arbitrary: fc.constant(0) }, { weight: 6, arbitrary: fc.integer({ min: 0, max: 3_000 }) }),
  status: statusArb,
  learned: fc.boolean(),
  code: fc.constantFrom('KeyF', 'KeyJ', 'F13', 'ArrowDown'),
});

/** Every action shape, for invalid picks and for the Input_Step property. */
function universe(pick: ActionPick, t: number): OnboardingAction[] {
  return [
    ...INPUT_CHOICES.map((choice): OnboardingAction => ({ type: 'choose', choice })),
    { type: 'use-key-tap' },
    { type: 'switch-result', result: pick.learned ? { ok: true, code: pick.code } : { ok: false, message: 'cancelled' } },
    { type: 'switch-retry' },
    { type: 'camera-on' },
    { type: 'blink-status', status: pick.status },
    { type: 'continue' },
    { type: 'press', kind: 'down', t },
    { type: 'press', kind: 'up', t },
    { type: 'use-default' },
    { type: 'practice-again' },
    { type: 'use-this-speed' },
    { type: 'start' },
    { type: 'cancel' },
  ];
}

/** Valid candidates, repeated to weight the steps that move a flow forward. */
function validCandidates(s: OnboardingState, pick: ActionPick, t: number): OnboardingAction[] {
  const weighted: OnboardingAction[] = [];
  const add = (a: OnboardingAction, times = 1): void => {
    if (!isValidAction(s, a)) return;
    for (let i = 0; i < times; i += 1) weighted.push(a);
  };
  const all = universe(pick, t);
  for (const a of all) {
    if (a.type === 'press') add(a, 6);
    else if (a.type === 'continue' || a.type === 'start' || a.type === 'use-this-speed') add(a, 2);
    else if (a.type === 'switch-result' || a.type === 'blink-status') add(a, 2);
    else add(a);
  }
  return weighted;
}

/** Resolves picks against the evolving state; timestamps never decrease and advance only on presses. */
export function resolveOnboardingActions(
  initial: OnboardingState,
  picks: readonly ActionPick[],
  opts: { readonly only?: ReadonlySet<OnboardingAction['type']> } = {},
): readonly OnboardingAction[] {
  let state = initial;
  let t = 0;
  const actions: OnboardingAction[] = [];
  for (const pick of picks) {
    const now = t + pick.dt;
    const keep = (a: OnboardingAction): boolean => opts.only === undefined || opts.only.has(a.type);
    const candidates = (
      pick.valid ? validCandidates(state, pick, now) : universe(pick, now).filter((a) => !isValidAction(state, a))
    ).filter(keep);
    const action = candidates[pick.which % Math.max(1, candidates.length)];
    if (action === undefined) continue;
    if (action.type === 'press') t = now;
    actions.push(action);
    state = onboardingStep(state, action);
  }
  return actions;
}

export interface OnboardingRun {
  readonly initial: OnboardingState;
  readonly actions: readonly OnboardingAction[];
}

/**
 * A stateful run of 0 to `max` actions (default 300): most valid in the current step, about 20 %
 * invalid, with non-decreasing timestamps, durations of 0 to 3000 ms, unmatched ups and restarts.
 */
export function arbOnboardingActions(
  opts: { readonly max?: number; readonly only?: ReadonlySet<OnboardingAction['type']> } = {},
): fc.Arbitrary<OnboardingRun> {
  return fc
    .record({
      initial: arbInitialOnboardingState(),
      picks: fc.array(actionPickArb, { maxLength: opts.max ?? 300, size: 'max' }),
    })
    .map(({ initial, picks }) => ({
      initial,
      actions: resolveOnboardingActions(initial, picks, opts.only === undefined ? {} : { only: opts.only }),
    }));
}

/** 5-tuples with at least one zero, negative, NaN or ±Infinity duration, so calibrate() falls back. */
export function arbFallbackDurations(): fc.Arbitrary<readonly number[]> {
  const bad = fc.oneof(
    fc.constant(0),
    fc.integer({ min: -3_000, max: -1 }),
    fc.double({ min: -3_000, max: 0, noNaN: true }),
    fc.constant(Number.NaN),
    fc.constant(Infinity),
    fc.constant(-Infinity),
  );
  return fc
    .record({
      good: fc.array(fc.integer({ min: 1, max: 3_000 }), { minLength: 5, maxLength: 5 }),
      bad: fc.array(bad, { minLength: 5, maxLength: 5 }),
      positions: fc.uniqueArray(fc.nat({ max: 4 }), { minLength: 1, maxLength: 5 }),
    })
    .map(({ good, bad: worse, positions }) => good.map((d, i) => (positions.includes(i) ? (worse[i] ?? 0) : d)))
    .filter((durations) => calibrate(durations).reason !== null);
}

export interface OnboardingFoldStep {
  readonly prev: OnboardingState;
  readonly action: OnboardingAction;
  readonly next: OnboardingState;
  readonly effects: readonly OnboardingEffect[];
}

/** Every transition of the run, with its effects. */
export function foldOnboarding(initial: OnboardingState, actions: readonly OnboardingAction[]): readonly OnboardingFoldStep[] {
  const steps: OnboardingFoldStep[] = [];
  let state = initial;
  for (const action of actions) {
    const next = onboardingStep(state, action);
    steps.push({ prev: state, action, next, effects: onboardingEffects(state, next, action) });
    state = next;
  }
  return steps;
}

// ---------------------------------------------------------------------------
// Onboarding_Record (task 10.3)

const positiveFiniteArb = fc.oneof(
  fc.integer({ min: 1, max: 5_000 }),
  fc.double({ min: 0, max: 1e300, noNaN: true, minExcluded: true }),
);

/** Any valid record: every Input_Choice, `complete` either way, estimates null or two positive numbers. */
export function arbValidRecord(): fc.Arbitrary<OnboardingRecord> {
  return fc.record({
    v: fc.constant(1 as const),
    complete: fc.boolean(),
    inputChoice: fc.constantFrom(...INPUT_CHOICES),
    estimates: fc.option(fc.record({ dotEstimate: positiveFiniteArb, dashEstimate: positiveFiniteArb }), {
      nil: null,
    }),
  });
}

type Field = 'v' | 'complete' | 'inputChoice' | 'estimates';

const MISSING = Symbol('missing');

const brokenValueArb: Readonly<Record<Field, fc.Arbitrary<unknown>>> = {
  v: fc.constantFrom<unknown>(0, 2, '1', true, null, 1.5, MISSING),
  complete: fc.constantFrom<unknown>('true', 1, 0, null, MISSING),
  inputChoice: fc.constantFrom<unknown>('keytap', 'Blink', 'switch ', '', 3, null, MISSING),
  estimates: fc.oneof(
    fc.constantFrom<unknown>(MISSING, 180, 'none', [180, 560], {}),
    fc.record({
      dotEstimate: fc.constantFrom<unknown>(0, -5, '180', null, true),
      dashEstimate: positiveFiniteArb,
    }),
    fc.record({ dotEstimate: positiveFiniteArb, dashEstimate: fc.constantFrom<unknown>(0, -0.5, '560', null) }),
    positiveFiniteArb.map((d) => ({ dotEstimate: d })),
    fc.tuple(positiveFiniteArb, positiveFiniteArb).map(([d, h]) => ({ dotEstimate: d, dashEstimate: h, reason: null })),
  ),
};

/** A valid record with exactly one field replaced by an invalid value (or removed). */
function nearMissArb(): fc.Arbitrary<string> {
  return fc
    .tuple(arbValidRecord(), fc.constantFrom<Field>('v', 'complete', 'inputChoice', 'estimates'))
    .chain(([record, field]) =>
      brokenValueArb[field].map((value) => {
        const copy: Record<string, unknown> = { ...record };
        if (value === MISSING) delete copy[field];
        else copy[field] = value;
        return JSON.stringify(copy);
      }),
    );
}

/** Raw text that is not JSON, or JSON with numbers no record may hold. */
const NON_JSON = [
  '',
  '{',
  'undefined',
  "{'v':1}",
  'NaN',
  '{"v":1,"complete":true,"inputChoice":"blink","estimates":{"dotEstimate":1e999,"dashEstimate":200}}',
  '{"v":1,"complete":true,"inputChoice":"key-tap","estimates":null,}',
];

/**
 * What localStorage may hold under ONBOARDING_KEY: valid complete and incomplete records, near
 * misses with one field broken, extra keys, random strings and JSON values, non-JSON text, and null.
 */
export function arbStoredRecord(): fc.Arbitrary<string | null> {
  return fc.oneof(
    { weight: 3, arbitrary: arbValidRecord().map(serializeOnboardingRecord) },
    { weight: 3, arbitrary: nearMissArb() },
    {
      weight: 1,
      arbitrary: fc
        .tuple(arbValidRecord(), fc.constantFrom('extra', 'V', 'version', 'estimate'), fc.jsonValue())
        .map(([record, key, value]) => JSON.stringify({ ...record, [key]: value })),
    },
    { weight: 1, arbitrary: fc.string() },
    { weight: 1, arbitrary: fc.jsonValue().map((value) => JSON.stringify(value)) },
    { weight: 1, arbitrary: fc.constantFrom(...NON_JSON) },
    { weight: 1, arbitrary: fc.constant(null) },
  );
}

/** Requirement 11.1 written out by hand, apart from the Zod schema, for Property 27. */
export function isValidStoredRecord(raw: string | null): boolean {
  if (raw === null) return false;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return false;
  }
  const isPlainObject = (x: unknown): x is Record<string, unknown> =>
    typeof x === 'object' && x !== null && !Array.isArray(x);
  if (!isPlainObject(value)) return false;
  if (Object.keys(value).sort().join(',') !== 'complete,estimates,inputChoice,v') return false;
  if (value.v !== 1 || typeof value.complete !== 'boolean') return false;
  if (value.inputChoice !== 'key-tap' && value.inputChoice !== 'switch' && value.inputChoice !== 'blink') return false;
  const estimates = value.estimates;
  if (estimates === null) return true;
  if (!isPlainObject(estimates)) return false;
  if (Object.keys(estimates).sort().join(',') !== 'dashEstimate,dotEstimate') return false;
  const positive = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x) && x > 0;
  return positive(estimates.dotEstimate) && positive(estimates.dashEstimate);
}
