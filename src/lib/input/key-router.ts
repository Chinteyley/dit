import type { Unsubscribe } from './types';

export interface KeyEventLike {
  readonly code: string;
  readonly repeat: boolean;
  preventDefault(): void;
}

/** browser.ts binds this to window keydown/keyup in the capture phase. */
export interface KeyEventTarget {
  addKeyListeners(onDown: (e: KeyEventLike) => void, onUp: (e: KeyEventLike) => void): Unsubscribe;
}

export interface KeyHandler {
  keyDown(e: KeyEventLike): void;
  keyUp(e: KeyEventLike): void;
}

export interface LearnerHook {
  isArmed(): boolean;
  /** Returns true when the learner consumed the keydown. */
  offer(e: KeyEventLike): boolean;
}

export interface KeyRouter {
  /** Registers a handler. The DOM listeners exist only while a handler or an armed learner is registered. */
  add(handler: KeyHandler): Unsubscribe;
  /** The Switch_Learner registers itself while armed and clears itself when it disarms. */
  setLearner(learner: LearnerHook | null): void;
}

/**
 * One keydown/keyup listener pair shared by the key sources. An armed learner sees every keydown
 * first; a code it consumes is suppressed until its keyup, even when that keyup arrives after the
 * learner disarmed (Req 5.5).
 */
export function createKeyRouter(target: KeyEventTarget): KeyRouter {
  const handlers = new Set<KeyHandler>();
  const learnSuppressed = new Set<string>();
  let learner: LearnerHook | null = null;
  let removeListeners: Unsubscribe | null = null;

  const dispatch = (deliver: (handler: KeyHandler) => void): void => {
    for (const handler of [...handlers]) {
      if (!handlers.has(handler)) continue;
      try {
        deliver(handler);
      } catch {
        // A failing handler must not stop the others.
      }
    }
  };

  const onDown = (e: KeyEventLike): void => {
    if (learner !== null && learner.isArmed() && learner.offer(e)) {
      learnSuppressed.add(e.code);
      return;
    }
    dispatch((handler) => handler.keyDown(e));
  };

  const onUp = (e: KeyEventLike): void => {
    if (learnSuppressed.delete(e.code)) {
      return;
    }
    dispatch((handler) => handler.keyUp(e));
  };

  const sync = (): void => {
    const wanted = handlers.size > 0 || learner !== null;
    if (wanted && removeListeners === null) {
      removeListeners = target.addKeyListeners(onDown, onUp);
    } else if (!wanted && removeListeners !== null) {
      removeListeners();
      removeListeners = null;
      // Keyups are not observed from here on, so a suppressed code cannot be matched any more.
      // A key still held at the next attach reaches the handlers with no press to end.
      learnSuppressed.clear();
    }
  };

  return {
    add(handler) {
      const own: KeyHandler = { keyDown: (e) => handler.keyDown(e), keyUp: (e) => handler.keyUp(e) };
      handlers.add(own);
      sync();
      return () => {
        if (handlers.delete(own)) sync();
      };
    },
    setLearner(next) {
      learner = next;
      sync();
    },
  };
}
