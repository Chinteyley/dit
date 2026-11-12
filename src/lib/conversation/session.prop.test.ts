import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { trimWhitespace } from '@/lib/expansion';
import { SUPPORTED_CHARACTERS, type EngineEvent } from '@/lib/morse';
import { INITIAL_SESSION, reduce, trimmedText } from './session';
import {
  PROP_RUNS,
  arbPattern,
  arbState,
  arbStateAndActions,
  arbStateDirect,
  arbSuggestionFields,
  arbSuggestionText,
  arbTurns,
  arbAction,
  deepFreeze,
  hydrateEntriesArb,
  nearMiss,
  partnerLineTextArb,
  pickIndexArb,
  sourceArb,
} from './test-support';
import {
  HISTORY_CAP,
  TEXT_MAX,
  type SessionAction,
  type SessionEffect,
  type SessionState,
  type SessionTurn,
  type Transition,
} from './types';

const engine = (event: EngineEvent): SessionAction => ({ type: 'engine', event });
const SPACE = engine({ type: 'space' });
const BACKSPACE = engine({ type: 'command', command: 'backspace' });
const NEXT = engine({ type: 'command', command: 'next' });
const SPEAK = engine({ type: 'command', command: 'speak' });
const RESET: SessionEffect = { type: 'reset-engine' };

/** Throws with a readable message; cheaper than expect() inside long folds. */
function check(condition: boolean, message: () => string): void {
  if (!condition) throw new Error(message());
}

const typingFields = (s: SessionState) => ({
  currentText: s.currentText,
  currentPattern: s.currentPattern,
  suggestions: s.suggestions,
  suggestionSource: s.suggestionSource,
  highlight: s.highlight,
});

const cleared = (s: SessionState): SessionState => ({ ...s, suggestions: [], suggestionSource: null, highlight: null });

/** Up to 499 characters, so one more character always fits. */
const arbShortTextState = arbState().map((s) =>
  s.currentText.length > TEXT_MAX - 1 ? { ...s, currentText: s.currentText.slice(0, TEXT_MAX - 1) } : s,
);

/** Field-by-field equality for Session_States, fast enough to run after every action of a long fold. */
function sameState(a: SessionState, b: SessionState): boolean {
  if (Object.keys(a).length !== 8 || Object.keys(b).length !== 8) return false;
  if (
    a.currentText !== b.currentText ||
    a.currentPattern !== b.currentPattern ||
    a.suggestionSource !== b.suggestionSource ||
    a.highlight !== b.highlight ||
    a.lastSpoken !== b.lastSpoken ||
    a.nextTurnId !== b.nextTurnId ||
    a.suggestions.length !== b.suggestions.length ||
    a.turns.length !== b.turns.length
  ) {
    return false;
  }
  for (let i = 0; i < a.suggestions.length; i++) if (a.suggestions[i] !== b.suggestions[i]) return false;
  for (let i = 0; i < a.turns.length; i++) {
    const x = a.turns[i] as SessionTurn;
    const y = b.turns[i] as SessionTurn;
    if (Object.keys(x).length !== 3 || x.id !== y.id || x.role !== y.role || x.text !== y.text) return false;
  }
  return true;
}

function sameEffects(a: readonly SessionEffect[], b: readonly SessionEffect[]): boolean {
  return a.length === b.length && a.every((effect, i) => JSON.stringify(effect) === JSON.stringify(b[i]));
}

/** Reference model of the single-event rows of the transition table. */
function engineModel(s: SessionState, event: EngineEvent): { state: SessionState; effects: SessionEffect[] } {
  const emptied: SessionState = { ...s, currentPattern: '' };
  const retext = (text: string): SessionState =>
    trimWhitespace(text) === trimWhitespace(s.currentText)
      ? { ...emptied, currentText: text }
      : cleared({ ...emptied, currentText: text });
  switch (event.type) {
    case 'symbol':
      return { state: { ...s, currentPattern: s.currentPattern + event.symbol }, effects: [] };
    case 'char':
      return { state: s.currentText.length < TEXT_MAX ? retext(s.currentText + event.char) : emptied, effects: [] };
    case 'space': {
      if (/(?:^|(?<= ))s *o *s$/.test(trimmedText(s))) {
        return { state: cleared({ ...emptied, currentText: trimmedText(s).replace(/(?:^|(?<= ))s *o *s$/, '') }), effects: [{ type: 'alarm' }] };
      }
      const t = s.currentText;
      const appends = t !== '' && !t.endsWith(' ') && t.length < TEXT_MAX;
      return { state: appends ? retext(`${t} `) : emptied, effects: [] };
    }
    case 'unknown':
      return { state: emptied, effects: [{ type: 'unknown', pattern: event.pattern }] };
    case 'command':
      if (event.command === 'backspace') {
        return { state: s.currentText === '' ? emptied : retext(s.currentText.slice(0, -1)), effects: [] };
      }
      if (event.command === 'sos') return { state: emptied, effects: [{ type: 'alarm' }] };
      throw new Error(`not modelled: ${event.command}`);
  }
}

const singleEventArb: fc.Arbitrary<EngineEvent> = fc.oneof(
  fc.constantFrom('.', '-').map((symbol): EngineEvent => ({ type: 'symbol', symbol })),
  fc.constantFrom(...SUPPORTED_CHARACTERS).map((char): EngineEvent => ({ type: 'char', char })),
  fc.constant<EngineEvent>({ type: 'space' }),
  arbPattern(10).filter((p) => p.length > 0).map((pattern): EngineEvent => ({ type: 'unknown', pattern })),
  fc.constant<EngineEvent>({ type: 'command', command: 'backspace' }),
  fc.constant<EngineEvent>({ type: 'command', command: 'sos' }),
);

// Folding up to 1,000 actions per run takes about 2 s per property at 200 runs on a laptop.
describe('Session_Reducer properties', { timeout: 60_000 }, () => {
  // Feature: conversation-ui, Property 1: Spacing and length invariant
  it('P1 spacing and length invariant', () => {
    const valid = (s: SessionState): boolean =>
      s.currentText.length <= TEXT_MAX && !s.currentText.startsWith(' ') && !s.currentText.includes('  ');
    fc.assert(
      fc.property(arbStateAndActions(1000), ({ state, actions }) => {
        let s = state;
        check(valid(s), () => `invalid start text ${JSON.stringify(s.currentText)}`);
        for (const [i, action] of actions.entries()) {
          s = reduce(s, action).state;
          check(valid(s), () => `action ${i} (${JSON.stringify(action)}) gave ${JSON.stringify(s.currentText)}`);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 2: Engine events follow the transition table
  it('P2 engine events follow the transition table', () => {
    fc.assert(
      fc.property(arbState(), singleEventArb, (s, event) => {
        const expected = engineModel(s, event);
        const actual = reduce(s, engine(event));
        expect(actual.state).toEqual(expected.state);
        expect(actual.effects).toEqual(expected.effects);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 3: Backspace inverse
  it('P3 backspace inverse', () => {
    fc.assert(
      fc.property(arbShortTextState, fc.constantFrom(...SUPPORTED_CHARACTERS), (s, char) => {
        const typed = reduce(s, engine({ type: 'char', char })).state;
        const back = reduce(typed, BACKSPACE).state;
        expect(back.currentText).toBe(s.currentText);
        expect(back.currentPattern).toBe('');
        const spaced = reduce(s, SPACE).state;
        if (spaced.currentText.length === s.currentText.length + 1) {
          expect(reduce(spaced, BACKSPACE).state.currentText).toBe(s.currentText);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 4: Suggestions are accepted only when fresh and dropped when the text changes
  it('P4 suggestions accepted only when fresh and dropped when the text changes', () => {
    const resultCase = arbState().chain((s) =>
      fc
        .record({
          fresh: fc.boolean(),
          miss: fc.constantFrom('case', 'inner', 'outer') as fc.Arbitrary<'case' | 'inner' | 'outer'>,
          suggestions: fc.array(arbSuggestionText(), { maxLength: 5 }),
          source: sourceArb,
        })
        .map(({ fresh, miss, suggestions, source }) => ({
          kind: 'result' as const,
          s,
          result: { text: fresh ? trimmedText(s) : nearMiss(trimmedText(s), miss), suggestions, source },
        })),
    );
    const textCase = arbStateDirect({ suggestions: arbSuggestionFields({ min: 1 }) }).chain((s) =>
      fc
        .oneof(
          fc.constantFrom(...SUPPORTED_CHARACTERS).map((char) => engine({ type: 'char', char })),
          fc.constant(SPACE),
          fc.constant(BACKSPACE),
        )
        .map((action) => ({ kind: 'text' as const, s, action })),
    );
    fc.assert(
      fc.property(fc.oneof(resultCase, textCase), (c) => {
        if (c.kind === 'result') {
          const { state: next, effects } = reduce(c.s, { type: 'suggestions', result: c.result });
          expect(effects).toEqual([]);
          if (c.result.text !== trimmedText(c.s)) {
            expect(next).toEqual(c.s);
          } else if (c.result.suggestions.length === 0) {
            expect(next).toEqual(cleared(c.s));
          } else {
            expect(next).toEqual({
              ...c.s,
              suggestions: c.result.suggestions.slice(0, 3),
              suggestionSource: c.result.source,
              highlight: 0,
            });
          }
          return;
        }
        const next = reduce(c.s, c.action).state;
        const kept = { suggestions: c.s.suggestions, suggestionSource: c.s.suggestionSource, highlight: c.s.highlight };
        const now = { suggestions: next.suggestions, suggestionSource: next.suggestionSource, highlight: next.highlight };
        if (trimmedText(next) === trimmedText(c.s)) {
          expect(now).toEqual(kept);
        } else {
          expect(now).toEqual({ suggestions: [], suggestionSource: null, highlight: null });
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 5: Highlight range invariant
  it('P5 highlight range invariant', () => {
    const valid = (s: SessionState): boolean => {
      const n = s.suggestions.length;
      const inRange = s.highlight === null || (Number.isInteger(s.highlight) && s.highlight >= 0 && s.highlight < n);
      return inRange && (n > 0 || s.highlight === null) && (s.suggestionSource === null) === (n === 0) && n <= 3;
    };
    fc.assert(
      fc.property(arbStateAndActions(1000), ({ state, actions }) => {
        let s = state;
        check(valid(s), () => 'invalid start state');
        for (const [i, action] of actions.entries()) {
          s = reduce(s, action).state;
          check(valid(s), () => `action ${i} (${JSON.stringify(action)}) broke the highlight invariant`);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 6: Highlight cycle
  it('P6 highlight cycle', () => {
    fc.assert(
      fc.property(arbStateDirect({ suggestions: arbSuggestionFields({ min: 1 }) }), (s) => {
        const n = s.suggestions.length;
        const expected = s.highlight === null ? 0 : s.highlight < n - 1 ? s.highlight + 1 : null;
        const { state: next, effects } = reduce(s, NEXT);
        expect(next).toEqual({ ...s, currentPattern: '', highlight: expected });
        expect(effects).toEqual([]);
        let cycled = s;
        for (let i = 0; i < n + 1; i++) cycled = reduce(cycled, NEXT).state;
        expect(cycled.highlight).toBe(s.highlight);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 7: Speak and Partner_Pick choose the right sentence
  it('P7 speak and partner pick choose the right sentence', () => {
    const op = fc.oneof(
      fc.constant({ kind: 'speak' as const }),
      pickIndexArb.map((index) => ({ kind: 'pick' as const, index })),
    );
    fc.assert(
      fc.property(arbState(), op, (s, o) => {
        if (o.kind === 'speak') {
          const { state: next, effects } = reduce(s, SPEAK);
          if (/(?:^|(?<= ))s *o *s$/.test(trimmedText(s))) {
            expect(effects).toEqual([{ type: 'alarm' }]);
          } else if (s.highlight !== null) {
            expect(effects).toEqual([{ type: 'speak', sentence: s.suggestions[s.highlight] }, RESET]);
          } else if (trimmedText(s) !== '') {
            expect(effects).toEqual([{ type: 'speak', sentence: trimmedText(s) }, RESET]);
          } else {
            expect(next).toEqual({ ...s, currentPattern: '' });
            expect(effects).toEqual([RESET]);
          }
          return;
        }
        const { state: next, effects } = reduce(s, { type: 'partner-pick', index: o.index });
        if (Number.isInteger(o.index) && o.index >= 0 && o.index < s.suggestions.length) {
          expect(effects).toEqual([{ type: 'speak', sentence: s.suggestions[o.index] }, RESET]);
        } else {
          expect(next).toEqual(s);
          expect(effects).toEqual([]);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 8: Speak clears state
  it('P8 speak clears state', () => {
    const anyState = fc.oneof(arbState(), arbStateDirect({ turns: arbTurns(fc.constant(HISTORY_CAP)) }));
    const speakCase = anyState.filter((s) => !/(?:^|(?<= ))s *o *s$/.test(trimmedText(s))).map((s) => {
      const state = s.highlight === null && trimmedText(s) === '' ? { ...s, currentText: 'ok' } : s;
      const sentence = state.highlight === null ? trimmedText(state) : (state.suggestions[state.highlight] ?? '');
      return { s: state, action: SPEAK, sentence };
    });
    const pickCase = fc
      .oneof(
        arbStateDirect({ suggestions: arbSuggestionFields({ min: 1 }) }),
        arbStateDirect({ suggestions: arbSuggestionFields({ min: 1 }), turns: arbTurns(fc.constant(HISTORY_CAP)) }),
      )
      .chain((s) =>
        fc.integer({ min: 0, max: s.suggestions.length - 1 }).map((index) => ({
          s,
          action: { type: 'partner-pick', index } as SessionAction,
          sentence: s.suggestions[index] ?? '',
        })),
      );
    fc.assert(
      fc.property(fc.oneof(speakCase, pickCase), ({ s, action, sentence }) => {
        const { state: next, effects } = reduce(s, action);
        expect(effects).toEqual([{ type: 'speak', sentence }, RESET]);
        expect(typingFields(next)).toEqual({
          currentText: '',
          currentPattern: '',
          suggestions: [],
          suggestionSource: null,
          highlight: null,
        });
        if (s.turns.length === HISTORY_CAP) {
          expect(next.turns).toHaveLength(HISTORY_CAP);
          expect(next.turns.slice(0, -1)).toEqual(s.turns.slice(1));
        } else {
          expect(next.turns).toHaveLength(s.turns.length + 1);
          expect(next.turns.slice(0, -1)).toEqual(s.turns);
        }
        const last = next.turns.at(-1);
        expect(last?.role).toBe('speaker');
        expect(last?.text).toBe(sentence);
        expect(next.lastSpoken).toBe(sentence);
        expect(s.turns.every((turn) => turn.id < (last?.id ?? 0))).toBe(true);
        expect(last?.id).toBeGreaterThanOrEqual(s.nextTurnId);
        expect(next.nextTurnId).toBeGreaterThan(last?.id ?? Number.POSITIVE_INFINITY);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 9: Turns invariant
  it('P9 turns invariant', () => {
    const problem = (s: SessionState): string | null => {
      if (s.turns.length > HISTORY_CAP) return `${s.turns.length} turns`;
      let previous = Number.NEGATIVE_INFINITY;
      for (const turn of s.turns) {
        if (!(turn.id > previous)) return `ids not increasing at ${turn.id}`;
        if (!(turn.id < s.nextTurnId)) return `id ${turn.id} not below nextTurnId ${s.nextTurnId}`;
        if (turn.role !== 'speaker' && turn.role !== 'partner') return `role ${String(turn.role)}`;
        if (turn.text.length < 1 || turn.text.length > TEXT_MAX) return `text length ${turn.text.length}`;
        previous = turn.id;
      }
      return null;
    };
    fc.assert(
      fc.property(arbStateAndActions(1000), ({ state, actions }) => {
        let s = state;
        let maxIssued = s.turns.reduce((max, turn) => Math.max(max, turn.id), 0);
        check(problem(s) === null, () => `start: ${problem(s)}`);
        for (const [i, action] of actions.entries()) {
          const before = new Set(s.turns.map((turn) => turn.id));
          const next = reduce(s, action).state;
          const found = problem(next);
          check(found === null, () => `action ${i} (${action.type}): ${found}`);
          check(next.nextTurnId >= s.nextTurnId, () => `action ${i}: counter went back`);
          for (const turn of next.turns) {
            if (!before.has(turn.id)) {
              check(turn.id > maxIssued, () => `action ${i}: new id ${turn.id} not above ${maxIssued}`);
            }
          }
          for (const turn of next.turns) maxIssued = Math.max(maxIssued, turn.id);
          s = next;
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 10: Partner_Line, Clear_History and Hydrate follow their model
  it('P10 partner line, clear history and hydrate follow their model', () => {
    const action: fc.Arbitrary<SessionAction> = fc.oneof(
      partnerLineTextArb.map((text): SessionAction => ({ type: 'partner-line', text })),
      fc.constant<SessionAction>({ type: 'clear-history' }),
      hydrateEntriesArb.map((turns): SessionAction => ({ type: 'hydrate', turns })),
    );
    const freshIds = (s: SessionState, next: SessionState, turns: readonly SessionTurn[]): void => {
      let previous = s.nextTurnId - 1;
      for (const turn of turns) {
        expect(turn.id).toBeGreaterThan(previous);
        previous = turn.id;
      }
      expect(next.nextTurnId).toBeGreaterThan(previous);
    };
    fc.assert(
      fc.property(arbState(), action, (s, a) => {
        const { state: next, effects } = reduce(s, a);
        expect(effects).toEqual([]);
        expect(typingFields(next)).toEqual(typingFields(s));
        if (a.type === 'partner-line') {
          const trimmed = trimWhitespace(a.text);
          if (trimmed === '') {
            expect(next).toEqual(s);
            return;
          }
          const kept = s.turns.length === HISTORY_CAP ? s.turns.slice(1) : s.turns;
          expect(next.turns.slice(0, -1)).toEqual(kept);
          const added = next.turns.at(-1);
          expect({ role: added?.role, text: added?.text }).toEqual({ role: 'partner', text: trimmed.slice(0, TEXT_MAX) });
          freshIds(s, next, next.turns.slice(-1));
          expect(next.lastSpoken).toBe(s.lastSpoken);
        } else if (a.type === 'clear-history') {
          expect(next.turns).toEqual([]);
          expect(next.lastSpoken).toBeNull();
          expect(next.nextTurnId).toBe(s.nextTurnId);
        } else if (a.type === 'hydrate') {
          const valid = a.turns
            .filter((entry) => (entry.role === 'speaker' || entry.role === 'partner') && trimWhitespace(entry.text) !== '')
            .map((entry) => ({ role: entry.role, text: trimWhitespace(entry.text).slice(0, TEXT_MAX) }))
            .slice(-HISTORY_CAP);
          expect(next.turns.map((turn) => ({ role: turn.role, text: turn.text }))).toEqual(valid);
          freshIds(s, next, next.turns);
          const speakers = valid.filter((entry) => entry.role === 'speaker');
          expect(next.lastSpoken).toBe(speakers.at(-1)?.text ?? null);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 11: Determinism
  it('P11 determinism', () => {
    fc.assert(
      fc.property(arbStateAndActions(1000), ({ state, actions }) => {
        let a = structuredClone(state);
        let b = structuredClone(state);
        for (const [i, action] of actions.entries()) {
          const ra: Transition = reduce(a, action);
          const rb: Transition = reduce(b, action);
          check(sameState(ra.state, rb.state), () => `action ${i}: states differ`);
          check(sameEffects(ra.effects, rb.effects), () => `action ${i}: effects differ`);
          a = ra.state;
          b = rb.state;
        }
        expect(a).toEqual(b);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 12: The reducer is total, synchronous and non-mutating
  it('P12 reducer is total, synchronous and non-mutating', () => {
    fc.assert(
      fc.property(
        arbState().chain((s) => arbAction(s).map((action) => ({ s, action }))),
        ({ s, action }) => {
          const stateBefore = structuredClone(s);
          const actionBefore = structuredClone(action);
          deepFreeze(s);
          deepFreeze(action);
          let result: unknown;
          expect(() => {
            result = reduce(s, action);
          }).not.toThrow();
          expect(typeof result).toBe('object');
          expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
          expect(Object.keys(result as object).sort()).toEqual(['effects', 'state']);
          expect((result as { then?: unknown }).then).toBeUndefined();
          expect(Array.isArray((result as Transition).effects)).toBe(true);
          expect(s).toEqual(stateBefore);
          expect(action).toEqual(actionBefore);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});

// Feature: conversation-ui, review 26.2: standalone typed SOS is reserved at word boundaries.
it('alarms on a final sos word at a space or speak, preserving preceding text', () => {
  fc.assert(fc.property(fc.constantFrom('', 'please ', 'help me '), fc.constantFrom('sos', 's o s'), fc.boolean(), (prefix, sos, speak) => {
    const state = { ...INITIAL_SESSION, currentText: `${prefix}${sos}`, suggestions: ['Unrelated.'], highlight: 0 };
    const result = reduce(state, speak ? SPEAK : SPACE);
    expect(result.effects).toEqual([{ type: 'alarm' }]);
    expect(result.state.currentText).toBe(prefix);
    expect(result.state.suggestions).toEqual([]);
    for (const text of ['sosx', 'xsos', 'sos help', 'so s', 'im so s', 's os']) {
      expect(reduce({ ...INITIAL_SESSION, currentText: text }, speak ? SPEAK : SPACE).effects).not.toContainEqual({ type: 'alarm' });
    }
  }), { numRuns: PROP_RUNS });
});
