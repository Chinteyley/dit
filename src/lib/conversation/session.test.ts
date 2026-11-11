import { afterEach, describe, expect, it, vi } from 'vitest';
import type { EngineEvent } from '@/lib/morse';
import { INITIAL_SESSION, contextWindow, reduce, trimmedText } from './session';
import { CONTEXT_WINDOW, HISTORY_CAP, TEXT_MAX, type SessionState, type SessionTurn } from './types';

const engine = (event: EngineEvent) => ({ type: 'engine', event }) as const;
const char = (c: string) => engine({ type: 'char', char: c });
const SPACE = engine({ type: 'space' });
const SPEAK = engine({ type: 'command', command: 'speak' });
const NEXT = engine({ type: 'command', command: 'next' });
const BACKSPACE = engine({ type: 'command', command: 'backspace' });
const SOS = engine({ type: 'command', command: 'sos' });

function state(overrides: Partial<SessionState> = {}): SessionState {
  return { ...INITIAL_SESSION, ...overrides };
}

function turns(n: number, firstId = 1): SessionTurn[] {
  return Array.from({ length: n }, (_, i) => ({
    id: firstId + i,
    role: i % 2 === 0 ? 'partner' : 'speaker',
    text: `line ${firstId + i}`,
  }));
}

const withSuggestions = (overrides: Partial<SessionState> = {}): SessionState =>
  state({
    currentText: 'iwtgo',
    suggestions: ['I want to go outside.', 'I want to go home.'],
    suggestionSource: 'on-device',
    highlight: 0,
    ...overrides,
  });

describe('INITIAL_SESSION and helpers', () => {
  it('starts empty with the Turn counter at 1', () => {
    expect(INITIAL_SESSION).toEqual({
      currentText: '',
      currentPattern: '',
      suggestions: [],
      suggestionSource: null,
      highlight: null,
      turns: [],
      lastSpoken: null,
      nextTurnId: 1,
    });
    expect(CONTEXT_WINDOW).toBe(10);
    expect(TEXT_MAX).toBe(500);
    expect(HISTORY_CAP).toBe(200);
  });

  it('trimmedText trims only the 4 Whitespace characters', () => {
    expect(trimmedText(state({ currentText: ' \t hi there \r\n' }))).toBe('hi there');
    expect(trimmedText(state({ currentText: '\u00a0hi' }))).toBe('\u00a0hi');
  });

  it('contextWindow keeps the newest 10 Turns, oldest first, without IDs', () => {
    expect(contextWindow([])).toEqual([]);
    const window = contextWindow(turns(13));
    expect(window).toHaveLength(10);
    expect(window[0]).toEqual({ role: 'speaker', text: 'line 4' });
    expect(window[9]).toEqual({ role: 'partner', text: 'line 13' });
    expect(Object.keys(window[0] ?? {})).toEqual(['role', 'text']);
  });
});

describe('engine events', () => {
  it('symbol appends to Current_Pattern only', () => {
    const before = withSuggestions({ currentPattern: '.-' });
    const { state: next, effects } = reduce(before, engine({ type: 'symbol', symbol: '-' }));
    expect(next).toEqual({ ...before, currentPattern: '.--' });
    expect(effects).toEqual([]);
  });

  it('char appends the character and empties Current_Pattern', () => {
    const { state: next, effects } = reduce(state({ currentText: 'h', currentPattern: '..' }), char('i'));
    expect(next.currentText).toBe('hi');
    expect(next.currentPattern).toBe('');
    expect(effects).toEqual([]);
  });

  it('char at 499 characters appends, at 500 it only empties Current_Pattern', () => {
    const at499 = reduce(state({ currentText: 'a'.repeat(499) }), char('b')).state;
    expect(at499.currentText).toBe(`${'a'.repeat(499)}b`);
    const full = state({ currentText: 'a'.repeat(500), currentPattern: '-' });
    const { state: next, effects } = reduce(full, char('b'));
    expect(next).toEqual({ ...full, currentPattern: '' });
    expect(effects).toEqual([]);
  });

  it('space appends one space only after a non-space character and below 500 characters', () => {
    expect(reduce(state({ currentText: 'hi' }), SPACE).state.currentText).toBe('hi ');
    expect(reduce(state({ currentText: '' }), SPACE).state.currentText).toBe('');
    expect(reduce(state({ currentText: 'hi ' }), SPACE).state.currentText).toBe('hi ');
    expect(reduce(state({ currentText: 'a'.repeat(499) }), SPACE).state.currentText).toBe(`${'a'.repeat(499)} `);
    const full = state({ currentText: 'a'.repeat(500), currentPattern: '..' });
    expect(reduce(full, SPACE)).toEqual({ state: { ...full, currentPattern: '' }, effects: [] });
  });

  it('a trailing space keeps the Suggestions because Trimmed_Text is unchanged', () => {
    const before = withSuggestions();
    const next = reduce(before, SPACE).state;
    expect(next.currentText).toBe('iwtgo ');
    expect(next.suggestions).toBe(before.suggestions);
    expect(next.highlight).toBe(0);
  });

  it('a new character clears the Suggestions', () => {
    const next = reduce(withSuggestions(), char('h')).state;
    expect(next).toMatchObject({ currentText: 'iwtgoh', suggestions: [], suggestionSource: null, highlight: null });
  });

  it('unknown empties Current_Pattern and returns exactly one unknown effect', () => {
    const before = withSuggestions({ currentPattern: '......' });
    const { state: next, effects } = reduce(before, engine({ type: 'unknown', pattern: '......' }));
    expect(next).toEqual({ ...before, currentPattern: '' });
    expect(effects).toEqual([{ type: 'unknown', pattern: '......' }]);
  });
});

describe('commands', () => {
  it('backspace drops the last character, Whitespace included', () => {
    expect(reduce(state({ currentText: 'hi ' }), BACKSPACE).state.currentText).toBe('hi');
    const { state: next, effects } = reduce(state({ currentText: 'hi', currentPattern: '----' }), BACKSPACE);
    expect(next).toMatchObject({ currentText: 'h', currentPattern: '' });
    expect(effects).toEqual([]);
  });

  it('backspace on empty text only empties Current_Pattern', () => {
    const before = state({ currentPattern: '-', turns: turns(2), nextTurnId: 3, lastSpoken: 'line 2' });
    expect(reduce(before, BACKSPACE)).toEqual({ state: { ...before, currentPattern: '' }, effects: [] });
  });

  it('backspace of a trailing space keeps the Suggestions', () => {
    const before = withSuggestions({ currentText: 'iwtgo ' });
    expect(reduce(before, BACKSPACE).state.suggestions).toEqual(before.suggestions);
  });

  it('next walks 0, 1, none, 0 for two Suggestions and stays none for none', () => {
    const at0 = withSuggestions({ currentPattern: '..--' });
    const at1 = reduce(at0, NEXT);
    expect(at1).toEqual({ state: { ...at0, currentPattern: '', highlight: 1 }, effects: [] });
    const atNone = reduce(at1.state, NEXT).state;
    expect(atNone.highlight).toBeNull();
    expect(reduce(atNone, NEXT).state.highlight).toBe(0);
    expect(reduce(state({ currentText: 'x' }), NEXT).state.highlight).toBeNull();
  });

  it('speak with a highlighted suggestion speaks it, records the Turn and clears the typing fields', () => {
    const before = withSuggestions({ highlight: 1, currentPattern: '.-.-.', turns: turns(1), nextTurnId: 2 });
    const { state: next, effects } = reduce(before, SPEAK);
    expect(effects).toEqual([{ type: 'speak', sentence: 'I want to go home.' }, { type: 'reset-engine' }]);
    expect(next).toEqual({
      currentText: '',
      currentPattern: '',
      suggestions: [],
      suggestionSource: null,
      highlight: null,
      turns: [...turns(1), { id: 2, role: 'speaker', text: 'I want to go home.' }],
      lastSpoken: 'I want to go home.',
      nextTurnId: 3,
    });
  });

  it('speak with no Highlight speaks the Trimmed_Text', () => {
    const { state: next, effects } = reduce(state({ currentText: 'yes please ' }), SPEAK);
    expect(effects).toEqual([{ type: 'speak', sentence: 'yes please' }, { type: 'reset-engine' }]);
    expect(next.turns).toEqual([{ id: 1, role: 'speaker', text: 'yes please' }]);
    expect(next.lastSpoken).toBe('yes please');
  });

  it('speak with Whitespace-only text only resets the Engine', () => {
    const before = state({ currentText: ' \t', currentPattern: '.' });
    expect(reduce(before, SPEAK)).toEqual({ state: { ...before, currentPattern: '' }, effects: [{ type: 'reset-engine' }] });
    expect(reduce(INITIAL_SESSION, SPEAK)).toEqual({ state: INITIAL_SESSION, effects: [{ type: 'reset-engine' }] });
  });

  it('speak at 200 Turns drops the oldest Turn', () => {
    const before = state({ currentText: 'ok', turns: turns(HISTORY_CAP), nextTurnId: HISTORY_CAP + 1 });
    const next = reduce(before, SPEAK).state;
    expect(next.turns).toHaveLength(HISTORY_CAP);
    expect(next.turns[0]?.id).toBe(2);
    expect(next.turns.at(-1)).toEqual({ id: HISTORY_CAP + 1, role: 'speaker', text: 'ok' });
  });

  it('sos empties Current_Pattern, returns exactly one alarm effect and changes nothing else', () => {
    const before = withSuggestions({ currentPattern: '...---...', turns: turns(3), nextTurnId: 4 });
    expect(reduce(before, SOS)).toEqual({ state: { ...before, currentPattern: '' }, effects: [{ type: 'alarm' }] });
  });
});

describe('suggestions', () => {
  it('a fresh result sets up to 3 suggestions, the source and Highlight 0', () => {
    const before = state({ currentText: 'iwtgo ' });
    const { state: next, effects } = reduce(before, {
      type: 'suggestions',
      result: { text: 'iwtgo', suggestions: ['a.', 'b.', 'c.', 'd.'], source: 'ai' },
    });
    expect(next).toEqual({ ...before, suggestions: ['a.', 'b.', 'c.'], suggestionSource: 'ai', highlight: 0 });
    expect(effects).toEqual([]);
  });

  it('a fresh empty result clears the suggestions', () => {
    const next = reduce(withSuggestions(), {
      type: 'suggestions',
      result: { text: 'iwtgo', suggestions: [], source: 'on-device' },
    }).state;
    expect(next).toMatchObject({ suggestions: [], suggestionSource: null, highlight: null });
  });

  it('a stale result (other text, other case or other spacing) changes nothing', () => {
    const before = withSuggestions({ currentText: 'i want' });
    for (const text of ['i wan', 'I want', 'i  want', ' i want']) {
      const result = { text, suggestions: ['x.'], source: 'ai' } as const;
      expect(reduce(before, { type: 'suggestions', result })).toEqual({ state: before, effects: [] });
    }
  });

  it('blank sentences in a malformed result are dropped', () => {
    const next = reduce(state({ currentText: 'hi' }), {
      type: 'suggestions',
      result: { text: 'hi', suggestions: [' ', 'Hi there.', ''], source: 'ai' },
    }).state;
    expect(next.suggestions).toEqual(['Hi there.']);
  });
});

describe('partner actions', () => {
  it('Partner_Line appends a trimmed partner Turn capped at 500 characters', () => {
    const before = withSuggestions({ nextTurnId: 7 });
    const { state: next, effects } = reduce(before, { type: 'partner-line', text: `  ${'x'.repeat(600)}\n` });
    expect(next).toEqual({ ...before, turns: [{ id: 7, role: 'partner', text: 'x'.repeat(500) }], nextTurnId: 8 });
    expect(effects).toEqual([]);
  });

  it('a Whitespace-only Partner_Line changes nothing', () => {
    const before = withSuggestions();
    expect(reduce(before, { type: 'partner-line', text: ' \t\r\n' })).toEqual({ state: before, effects: [] });
  });

  it('Partner_Pick speaks the picked suggestion whatever the Highlight and text', () => {
    const before = withSuggestions({ highlight: 0, currentText: 'iwtgo h' });
    const { state: next, effects } = reduce(before, { type: 'partner-pick', index: 1 });
    expect(effects).toEqual([{ type: 'speak', sentence: 'I want to go home.' }, { type: 'reset-engine' }]);
    expect(next.currentText).toBe('');
    expect(next.lastSpoken).toBe('I want to go home.');
  });

  it('Partner_Pick out of range, fractional or not a number changes nothing', () => {
    const before = withSuggestions();
    for (const index of [-1, 2, 0.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(reduce(before, { type: 'partner-pick', index })).toEqual({ state: before, effects: [] });
    }
    expect(reduce(state(), { type: 'partner-pick', index: 0 })).toEqual({ state: state(), effects: [] });
  });

  it('Clear_History empties Turns and Last_Spoken but keeps the counter and typing fields', () => {
    const before = withSuggestions({ turns: turns(4), lastSpoken: 'line 4', nextTurnId: 9 });
    const { state: next, effects } = reduce(before, { type: 'clear-history' });
    expect(next).toEqual({ ...before, turns: [], lastSpoken: null, nextTurnId: 9 });
    expect(effects).toEqual([]);
  });

  it('Hydrate keeps valid entries, trims and caps their text, assigns fresh IDs and sets Last_Spoken', () => {
    const before = withSuggestions({ nextTurnId: 5 });
    const { state: next, effects } = reduce(before, {
      type: 'hydrate',
      turns: [
        { role: 'partner', text: '  Are you thirsty? ' },
        { role: 'system', text: 'not a role' },
        { role: 'speaker', text: '   ' },
        { role: 'speaker', text: 'Yes, water please.' },
        { role: 'Speaker', text: 'wrong case' },
        { role: 'partner', text: `${'y'.repeat(520)}` },
      ],
    });
    expect(effects).toEqual([]);
    expect(next).toEqual({
      ...before,
      turns: [
        { id: 5, role: 'partner', text: 'Are you thirsty?' },
        { id: 6, role: 'speaker', text: 'Yes, water please.' },
        { id: 7, role: 'partner', text: 'y'.repeat(500) },
      ],
      lastSpoken: 'Yes, water please.',
      nextTurnId: 8,
    });
  });

  it('Hydrate keeps only the newest 200 valid entries', () => {
    const entries = Array.from({ length: 230 }, (_, i) => ({ role: 'partner', text: `p${i}` }));
    const next = reduce(INITIAL_SESSION, { type: 'hydrate', turns: entries }).state;
    expect(next.turns).toHaveLength(200);
    expect(next.turns[0]).toEqual({ id: 1, role: 'partner', text: 'p30' });
    expect(next.lastSpoken).toBeNull();
    expect(next.nextTurnId).toBe(201);
  });
});

describe('purity', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reduce reads no clock or random source', () => {
    const boom = (): never => {
      throw new Error('reduce must not read the clock or random source');
    };
    vi.spyOn(Date, 'now').mockImplementation(boom);
    vi.spyOn(Math, 'random').mockImplementation(boom);
    vi.spyOn(performance, 'now').mockImplementation(boom);
    let s = INITIAL_SESSION;
    for (const action of [
      char('h'),
      char('i'),
      SPACE,
      { type: 'suggestions', result: { text: 'hi', suggestions: ['Hi there.'], source: 'ai' } } as const,
      NEXT,
      SPEAK,
      { type: 'partner-line', text: 'hello' } as const,
      { type: 'hydrate', turns: [{ role: 'speaker', text: 'x' }] } as const,
      { type: 'clear-history' } as const,
      SOS,
    ]) {
      s = reduce(s, action).state;
    }
    expect(s.turns).toEqual([]);
  });
});
