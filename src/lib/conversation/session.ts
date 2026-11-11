/**
 * The Session_Reducer (design "lib/conversation/session.ts"): a pure, total, synchronous function
 * from (Session_State, Session_Action) to the next state and an ordered list of Session_Effects.
 * It reads no clock, random source, storage, DOM or module-level mutable state (Req 7), and it
 * never mutates its inputs: unchanged fields, including the Turns array, keep their identity.
 */
import { trimWhitespace, type ExpansionResult, type Role } from '@/lib/expansion';
import type { CommandName, EngineEvent } from '@/lib/morse';
import {
  CONTEXT_WINDOW,
  HISTORY_CAP,
  TEXT_MAX,
  type HydrateEntry,
  type SessionAction,
  type SessionEffect,
  type SessionState,
  type SessionTurn,
  type Transition,
} from './types';

const NO_EFFECTS: readonly SessionEffect[] = Object.freeze([]);
const NO_TURNS: readonly SessionTurn[] = Object.freeze([]);
const NO_SUGGESTIONS: readonly string[] = Object.freeze([]);
const RESET_ENGINE: readonly SessionEffect[] = Object.freeze([Object.freeze({ type: 'reset-engine' } as const)]);
const ALARM: readonly SessionEffect[] = Object.freeze([Object.freeze({ type: 'alarm' } as const)]);

export const INITIAL_SESSION: SessionState = Object.freeze({
  currentText: '',
  currentPattern: '',
  suggestions: NO_SUGGESTIONS,
  suggestionSource: null,
  highlight: null,
  turns: NO_TURNS,
  lastSpoken: null,
  nextTurnId: 1,
});

/** Current_Text without leading or trailing Whitespace (the 4 Whitespace characters only). */
export function trimmedText(state: SessionState): string {
  return trimWhitespace(state.currentText);
}

/** The most recent 10 or fewer Turns, oldest first, as { role, text } without IDs (Req 6.7). */
export function contextWindow(turns: readonly SessionTurn[]): readonly { role: Role; text: string }[] {
  return turns.slice(-CONTEXT_WINDOW).map((turn) => ({ role: turn.role, text: turn.text }));
}

function unchanged(state: SessionState): Transition {
  return { state, effects: NO_EFFECTS };
}

/** The state with an empty Current_Pattern, reusing the input object when it already is empty. */
function withoutPattern(state: SessionState): SessionState {
  return state.currentPattern === '' ? state : { ...state, currentPattern: '' };
}

function clearSuggestions(state: SessionState): SessionState {
  if (state.suggestions.length === 0 && state.suggestionSource === null && state.highlight === null) {
    return state;
  }
  return { ...state, suggestions: NO_SUGGESTIONS, suggestionSource: null, highlight: null };
}

/** Appends a Turn with a fresh ID and keeps the newest HISTORY_CAP (Req 4.9, 6.3, 6.4). */
function appendTurn(state: SessionState, role: Role, text: string): SessionState {
  const turn: SessionTurn = { id: state.nextTurnId, role, text: text.slice(0, TEXT_MAX) };
  return {
    ...state,
    turns: [...state.turns, turn].slice(-HISTORY_CAP),
    nextTurnId: state.nextTurnId + 1,
  };
}

/** Speak_Step: record the speaker Turn and Last_Spoken, clear the typing fields (Req 4.6 to 4.8). */
function speakStep(state: SessionState, sentence: string): Transition {
  const spoken = sentence.slice(0, TEXT_MAX);
  const appended = appendTurn(state, 'speaker', spoken);
  return {
    state: {
      ...appended,
      lastSpoken: spoken,
      currentText: '',
      currentPattern: '',
      suggestions: NO_SUGGESTIONS,
      suggestionSource: null,
      highlight: null,
    },
    effects: [{ type: 'speak', sentence: spoken }, { type: 'reset-engine' }],
  };
}

/** Applies a Current_Text change and clears the Suggestions only when Trimmed_Text changed (Req 3.4, 3.5). */
function withText(state: SessionState, text: string): SessionState {
  if (text === state.currentText) return state;
  const next = { ...state, currentText: text };
  return trimWhitespace(text) === trimWhitespace(state.currentText) ? next : clearSuggestions(next);
}

function nextHighlight(state: SessionState): number | null {
  const n = state.suggestions.length;
  if (n === 0) return null;
  if (state.highlight === null) return 0;
  return state.highlight < n - 1 ? state.highlight + 1 : null;
}

function isIndex(state: SessionState, index: number): boolean {
  return Number.isInteger(index) && index >= 0 && index < state.suggestions.length;
}

/** Letter-by-letter SOS is reserved at the end of a word, before suggestions or speech. */
function typedSos(state: SessionState): Transition | null {
  const match = /(?:^|(?<= ))s *o *s$/.exec(trimmedText(state));
  if (match === null) return null;
  const text = trimmedText(state).slice(0, match.index);
  return { state: clearSuggestions(withText(withoutPattern(state), text)), effects: ALARM };
}

function commandStep(state: SessionState, command: CommandName): Transition {
  const cleared = withoutPattern(state);
  switch (command) {
    case 'backspace':
      return unchanged(cleared.currentText === '' ? cleared : withText(cleared, cleared.currentText.slice(0, -1)));
    case 'next': {
      const highlight = nextHighlight(cleared);
      return unchanged(highlight === cleared.highlight ? cleared : { ...cleared, highlight });
    }
    case 'speak': {
      const sos = typedSos(cleared);
      if (sos !== null) return sos;
      const { highlight } = cleared;
      if (highlight !== null && isIndex(cleared, highlight)) {
        return speakStep(cleared, cleared.suggestions[highlight] ?? '');
      }
      const trimmed = trimmedText(cleared);
      return trimmed === '' ? { state: cleared, effects: RESET_ENGINE } : speakStep(cleared, trimmed);
    }
    case 'sos':
      return { state: cleared, effects: ALARM };
    default:
      return unchanged(cleared);
  }
}

function engineStep(state: SessionState, event: EngineEvent): Transition {
  switch (event.type) {
    case 'symbol':
      return event.symbol === '.' || event.symbol === '-'
        ? unchanged({ ...state, currentPattern: state.currentPattern + event.symbol })
        : unchanged(state);
    case 'char': {
      const cleared = withoutPattern(state);
      return unchanged(
        cleared.currentText.length < TEXT_MAX ? withText(cleared, cleared.currentText + event.char) : cleared,
      );
    }
    case 'space': {
      const sos = typedSos(state);
      if (sos !== null) return sos;
      const cleared = withoutPattern(state);
      const text = cleared.currentText;
      const appends = text !== '' && !text.endsWith(' ') && text.length < TEXT_MAX;
      return unchanged(appends ? withText(cleared, `${text} `) : cleared);
    }
    case 'unknown':
      return { state: withoutPattern(state), effects: [{ type: 'unknown', pattern: event.pattern }] };
    case 'command':
      return commandStep(state, event.command);
    default:
      return unchanged(state);
  }
}

/** Suggestions_Received: accepted only when it answers the current Trimmed_Text (Req 3.1 to 3.3). */
function suggestionsStep(state: SessionState, result: ExpansionResult): Transition {
  if (result.text !== trimmedText(state)) return unchanged(state);
  // The expansion schema already forbids blank sentences; dropping them keeps the turns invariant.
  const kept = result.suggestions.filter((sentence) => trimWhitespace(sentence) !== '').slice(0, 3);
  if (kept.length === 0) return unchanged(clearSuggestions(state));
  return unchanged({ ...state, suggestions: kept, suggestionSource: result.source, highlight: 0 });
}

function partnerLineStep(state: SessionState, text: string): Transition {
  const trimmed = trimWhitespace(text);
  return trimmed === '' ? unchanged(state) : unchanged(appendTurn(state, 'partner', trimmed));
}

function isRole(role: string): role is Role {
  return role === 'speaker' || role === 'partner';
}

/** Hydrate: replace Turns with the newest 200 valid stored entries under fresh IDs (Req 6.6). */
function hydrateStep(state: SessionState, entries: readonly HydrateEntry[]): Transition {
  const valid: { readonly role: Role; readonly text: string }[] = [];
  for (const entry of entries) {
    if (typeof entry.text !== 'string' || typeof entry.role !== 'string' || !isRole(entry.role)) continue;
    const text = trimWhitespace(entry.text);
    if (text !== '') valid.push({ role: entry.role, text: text.slice(0, TEXT_MAX) });
  }
  const kept = valid.slice(-HISTORY_CAP);
  if (kept.length === 0 && state.turns.length === 0 && state.lastSpoken === null) return unchanged(state);
  const turns = kept.map((entry, i) => ({ id: state.nextTurnId + i, role: entry.role, text: entry.text }));
  let lastSpoken: string | null = null;
  for (const turn of turns) {
    if (turn.role === 'speaker') lastSpoken = turn.text;
  }
  return unchanged({
    ...state,
    turns: turns.length === 0 ? NO_TURNS : turns,
    lastSpoken,
    nextTurnId: state.nextTurnId + turns.length,
  });
}

/** Pure, total, synchronous. Never mutates its inputs; returns new objects only where fields change. */
export function reduce(state: SessionState, action: SessionAction): Transition {
  switch (action.type) {
    case 'engine':
      return engineStep(state, action.event);
    case 'suggestions':
      return suggestionsStep(state, action.result);
    case 'partner-line':
      return typeof action.text === 'string' ? partnerLineStep(state, action.text) : unchanged(state);
    case 'partner-pick':
      return isIndex(state, action.index)
        ? speakStep(state, state.suggestions[action.index] ?? '')
        : unchanged(state);
    case 'clear-history':
      return state.turns.length === 0 && state.lastSpoken === null
        ? unchanged(state)
        : unchanged({ ...state, turns: NO_TURNS, lastSpoken: null });
    case 'hydrate':
      return hydrateStep(state, action.turns);
    default:
      return unchanged(state);
  }
}
