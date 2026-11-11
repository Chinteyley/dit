import type { KeyEventLike, KeyRouter, LearnerHook } from './key-router';
import type { SettingsStore } from './settings';
import { validateSwitchKey, type SwitchSource } from './switch';
import { err, ok, type Result } from './types';

export type LearnError =
  | { readonly reason: 'reserved-input'; readonly code: string; readonly message: string }
  | { readonly reason: 'cancelled'; readonly message: string }
  | { readonly reason: 'save-failed'; readonly message: string };

export interface SwitchKeySnapshot {
  readonly active: string | null;
  readonly stored: string | null;
}

export interface SwitchLearner {
  /** Setup rollback keeps the active and persisted keys separately. */
  snapshot(): SwitchKeySnapshot;
  restore(snapshot: SwitchKeySnapshot): Result<void, { readonly reason: 'save-failed'; readonly message: string }>;
  /** Arms the learner. Resolves on the next qualifying keydown or on cancel(). Never rejects. No timeout (Req 5.5). */
  arm(): Promise<Result<string, LearnError>>;
  cancel(): void;
  isArmed(): boolean;
  /** Clears the key (Req 5.6). */
  clear(): Result<void, { readonly reason: 'save-failed'; readonly message: string }>;
}

const KEYBOARD_INPUT_CODES: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter']);
const CANCELLED: LearnError = Object.freeze({ reason: 'cancelled', message: 'Switch learning was cancelled.' });
const SAVE_FAILED = Object.freeze({ reason: 'save-failed', message: 'The switch key could not be saved.' } as const);

/**
 * Records the next key press as the Learned_Switch_Key (Req 5.1 to 5.6, 5.12). While armed it is
 * registered with the KeyRouter, which gives it the first look at every keydown and swallows the
 * learning press's keyup for every source.
 */
export function createSwitchLearner(deps: {
  readonly router: KeyRouter;
  readonly store: SettingsStore;
  readonly switchSource: SwitchSource;
}): SwitchLearner {
  let resolvePending: ((result: Result<string, LearnError>) => void) | null = null;

  const isArmed = (): boolean => resolvePending !== null;

  const disarm = (result: Result<string, LearnError>): void => {
    const resolve = resolvePending;
    resolvePending = null;
    deps.router.setLearner(null);
    resolve?.(result);
  };

  const learn = (code: string): Result<string, LearnError> => {
    const saved = deps.store.writeSwitchKey(code);
    if (!saved.ok) {
      // Req 5.12: the previous key stays in use and in the store.
      return err(SAVE_FAILED);
    }
    deps.switchSource.setLearnedKey(code);
    return ok(code);
  };

  const hook: LearnerHook = {
    isArmed,
    offer(e: KeyEventLike) {
      if (e.repeat || e.code === '' || e.code === 'Tab' || e.code === 'Escape') {
        // Req 5.3: stay armed; Tab and Escape keep their native behaviour.
        return false;
      }
      e.preventDefault();
      if (KEYBOARD_INPUT_CODES.has(e.code)) {
        // Req 5.2: Space and Enter already key Morse through the Keyboard_Source.
        disarm(err({ reason: 'reserved-input', code: e.code, message: 'This key already works as an input.' }));
        return true;
      }
      // Every Reserved_Key was handled above, so this code is a valid Learned_Switch_Key.
      disarm(learn(e.code));
      return true;
    },
  };

  return {
    snapshot() {
      const stored = deps.store.readSwitchKey();
      const active = deps.switchSource.learnedKey();
      return { active, stored: stored.ok ? validateSwitchKey(stored.value) : active };
    },
    restore(snapshot) {
      const saved = snapshot.stored === null ? deps.store.clearSwitchKey() : deps.store.writeSwitchKey(snapshot.stored);
      deps.switchSource.setLearnedKey(snapshot.active);
      return saved.ok ? ok(undefined) : err(SAVE_FAILED);
    },
    arm() {
      if (resolvePending !== null) {
        disarm(err(CANCELLED));
      }
      const promise = new Promise<Result<string, LearnError>>((resolve) => {
        resolvePending = resolve;
      });
      deps.router.setLearner(hook);
      return promise;
    },
    cancel() {
      if (resolvePending !== null) disarm(err(CANCELLED));
    },
    isArmed,
    clear() {
      const cleared = deps.store.clearSwitchKey();
      // Req 5.6 asks for no key, so the key in use is cleared even when the store fails.
      deps.switchSource.setLearnedKey(null);
      return cleared.ok ? ok(undefined) : err(SAVE_FAILED);
    },
  };
}
