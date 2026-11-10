/**
 * Session types for the conversation UI (design "lib/conversation/types.ts"). Everything is
 * readonly: the Session_Reducer returns new values and never mutates its inputs (Req 7.2).
 */
import { CONTEXT_MAX_TURNS, type ExpansionResult, type Role } from '@/lib/expansion';
import type { EngineEvent } from '@/lib/morse';

/** Longest Current_Text, in UTF-16 code units (Req 1.2). */
export const TEXT_MAX = 500;
/** History_Cap: most Turns kept (Req 6.3). */
export const HISTORY_CAP = 200;
/** Context_Window: most recent Turns passed to the Client (Req 6.7); the expansion limit. */
export const CONTEXT_WINDOW = CONTEXT_MAX_TURNS;

export interface SessionTurn {
  /** Unique, strictly increasing in Turns order. */
  readonly id: number;
  readonly role: Role;
  /** 1 to 500 characters, trimmed. */
  readonly text: string;
}

export type SuggestionSource = 'ai' | 'on-device';

export interface SessionState {
  /** 0 to 500 characters. */
  readonly currentText: string;
  /** '.' and '-' only. */
  readonly currentPattern: string;
  /** 0 to 3 sentences. */
  readonly suggestions: readonly string[];
  /** null exactly when suggestions is empty. */
  readonly suggestionSource: SuggestionSource | null;
  /** null = the raw Current_Text is selected; otherwise 0 to suggestions.length - 1. */
  readonly highlight: number | null;
  /** Oldest first, at most HISTORY_CAP. */
  readonly turns: readonly SessionTurn[];
  readonly lastSpoken: string | null;
  /** Greater than every Turn ID ever issued in this state's history. */
  readonly nextTurnId: number;
}

/** Loose shape accepted by Hydrate; the reducer drops invalid entries (Req 6.6). */
export interface HydrateEntry {
  readonly role: string;
  readonly text: string;
}

export type SessionAction =
  | { readonly type: 'engine'; readonly event: EngineEvent }
  | { readonly type: 'suggestions'; readonly result: ExpansionResult }
  | { readonly type: 'partner-line'; readonly text: string }
  | { readonly type: 'partner-pick'; readonly index: number }
  | { readonly type: 'clear-history' }
  | { readonly type: 'hydrate'; readonly turns: readonly HydrateEntry[] };

export type SessionEffect =
  | { readonly type: 'speak'; readonly sentence: string }
  | { readonly type: 'reset-engine' }
  | { readonly type: 'alarm' }
  | { readonly type: 'unknown'; readonly pattern: string };

export interface Transition {
  readonly state: SessionState;
  readonly effects: readonly SessionEffect[];
}
