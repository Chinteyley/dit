/**
 * The Alarm_Handler (design "lib/safety/alarm-handler.ts", Requirements 1, 2 and 7): implements the
 * conversation-ui AlarmHandler by running the Alarm_Machine's effects. The state is committed
 * before any effect runs, every effect runs in its own try/catch, and nothing awaits, so start()
 * always returns with the alarm ringing, whatever fails (Requirements 7.1 to 7.5).
 */
import type { AlarmHandler } from '@/lib/conversation';
import type { Unsubscribe } from '@/lib/input';
import { alarmStep, isAlarmActive, type AlarmEffect, type AlarmInput, type AlarmState } from './alarm-machine';
import type { ChimePlayer } from './chime-player';

/** The AlarmCard component implements this and registers it. All methods synchronous. */
export interface CardView {
  /** dialog.showModal(), then focus Dismiss. */
  show(): void;
  /** dialog.close() */
  hide(): void;
}

export interface SafetyAlarmHandler extends AlarmHandler {
  /** Partner Dismiss button (keyboard activation), Escape, or a dialog cancel/close not caused by hide(). */
  partnerDismiss(): void;
  /** AlarmCard pointer path: pointerdown → 'down', matching pointerup/pointercancel → 'up'. Not Press_Events. */
  cardPointer(kind: 'down' | 'up'): void;
  state(): AlarmState;
  setView(view: CardView | null): void;
  /** Called on every return to idle (Requirements 2.10, 18.9); it should focus on the next animation frame. */
  setFocusKeyingSurface(fn: (() => void) | null): void;
  /** The sound-unavailable text for the card (Requirement 6.5). */
  soundUnavailable(): boolean;
  /** Fires when the state or the sound note changes. */
  subscribe(listener: () => void): Unsubscribe;
}

function callEach<T extends unknown[]>(listeners: Iterable<(...args: T) => void>, ...args: T): void {
  for (const listener of [...listeners]) {
    try {
      listener(...args);
    } catch {
      // A throwing listener must not block the others (Requirement 2.8).
    }
  }
}

export function createAlarmHandler(deps: { readonly chime: ChimePlayer }): SafetyAlarmHandler {
  const { chime } = deps;
  let current: AlarmState = 'idle';
  let view: CardView | null = null;
  let focusKeyingSurface: (() => void) | null = null;
  const activeListeners = new Set<(active: boolean) => void>();
  const subscribers = new Set<() => void>();

  const notify = (): void => callEach(subscribers);
  // The chime lives as long as the handler, so this subscription is never removed.
  chime.onSoundChange(notify);

  const run = (effect: AlarmEffect): void => {
    switch (effect.type) {
      case 'show-card':
        view?.show(); // A missing view or a throw is caught by apply (Requirement 7.3).
        return;
      case 'start-chime':
        chime.start();
        return;
      case 'hide-card':
        view?.hide();
        return;
      case 'stop-chime':
        chime.stop();
        return;
      case 'active-change':
        callEach(activeListeners, effect.active);
        if (!effect.active) focusKeyingSurface?.();
        return;
    }
  };

  const apply = (input: AlarmInput): void => {
    const before = current;
    const step = alarmStep(before, input);
    current = step.state; // committed first, so isActive() is right while effects run (7.1)
    for (const effect of step.effects) {
      try {
        run(effect);
      } catch {
        // Each effect is isolated: a failed card still lets the chime start, and the reverse (7.3, 7.4).
      }
    }
    if (current !== before) notify();
  };

  return {
    start: () => apply('start'),
    isActive: () => isAlarmActive(current),
    handlePress: (event) => apply(event.kind),
    onActiveChange(listener) {
      const wrapped = (active: boolean): void => listener(active);
      activeListeners.add(wrapped);
      return () => {
        activeListeners.delete(wrapped);
      };
    },
    partnerDismiss: () => apply('partner-dismiss'),
    cardPointer: (kind) => apply(kind),
    state: () => current,
    setView(next) {
      view = next;
    },
    setFocusKeyingSurface(fn) {
      focusKeyingSurface = fn;
    },
    soundUnavailable: () => chime.soundUnavailable(),
    subscribe(listener) {
      const wrapped = (): void => listener();
      subscribers.add(wrapped);
      return () => {
        subscribers.delete(wrapped);
      };
    },
  };
}
