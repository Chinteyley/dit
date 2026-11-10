/**
 * The Cheat_Sheet store (design "lib/onboarding/cheat-sheet-store.ts", Requirement 10): holds the
 * Cheat_Sheet state for the page and implements the conversation-ui UnknownPatternHandler, so an
 * unknown pattern opens the sheet with reason `unknown`.
 */
import type { UnknownPatternHandler } from '@/lib/conversation';
import type { Unsubscribe } from '@/lib/input';
import {
  CLOSED_SHEET,
  cheatSheetStep,
  type CheatSheetAction,
  type CheatSheetContext,
  type CheatSheetState,
} from './cheat-sheet-state';

export interface CheatSheetStore {
  getState(): CheatSheetState;
  dispatch(a: CheatSheetAction): void;
  /** Called once per state change. */
  subscribe(listener: () => void): Unsubscribe;
}

/** `ctx` is read on every dispatch, so the alarm and onboarding flags are current. */
export function createCheatSheetStore(ctx: () => CheatSheetContext): CheatSheetStore {
  let state: CheatSheetState = CLOSED_SHEET;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    dispatch(a) {
      const next = cheatSheetStep(state, a, ctx());
      if (next === state) return;
      state = next;
      for (const listener of [...listeners]) {
        try {
          listener();
        } catch {
          // One subscriber must not break the others.
        }
      }
    },
    subscribe(listener) {
      const wrapped = (): void => listener();
      listeners.add(wrapped);
      return () => {
        listeners.delete(wrapped);
      };
    },
  };
}

/** The session's Unknown_Pattern_Handler: an `unknown` Engine_Event opens the sheet (Requirement 10.1). */
export function createUnknownPatternHandler(store: CheatSheetStore): UnknownPatternHandler {
  return { handle: (pattern) => store.dispatch({ type: 'unknown', pattern }) };
}
