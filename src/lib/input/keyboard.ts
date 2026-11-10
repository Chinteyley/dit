import type { Clock, Scheduler } from './clock';
import { createDebouncer } from './debounce';
import type { FocusClass } from './focus';
import { INITIAL_KEY_MACHINE_STATE, abandonActive, keyDown, keyUp, type FocusRule } from './key-machine';
import type { KeyHandler, KeyRouter } from './key-router';
import { createSourceCore, type PageLifecycle } from './source-base';
import type { PressSource, Result, SettingError, Unsubscribe } from './types';

export interface KeySourceDeps {
  readonly router: KeyRouter;
  readonly clock: Clock;
  readonly scheduler: Scheduler;
  readonly page: PageLifecycle;
  /** The hook passes () => classifyFocus(describeElement(document.activeElement, surface)). */
  readonly focus: () => FocusClass;
  readonly minPressDuration?: number;
}

export interface KeySource extends PressSource {
  setMinPressDuration(value: unknown): Result<number, SettingError>;
}

/** The Keyboard_Source codes (Req 4.1). */
export const KEYBOARD_CODES: ReadonlySet<string> = new Set(['Space', 'Enter', 'NumpadEnter']);

/** Internal: the shared key source behind the Keyboard_Source and the Switch_Source. */
export interface KeySourceParts {
  readonly source: KeySource;
  /** Passes a Raw_Up at the clock for an active press and forgets the key (Req 5.13). */
  readonly releaseActive: () => void;
}

/**
 * One KeyMachine and one Debouncer over the router's key events. `codes` is read on every keydown,
 * so the switch can change its key while running.
 */
export function createKeySource(
  deps: KeySourceDeps,
  kind: 'keyboard' | 'switch',
  rule: FocusRule,
  codes: () => ReadonlySet<string>,
): KeySourceParts {
  const debouncer = createDebouncer(kind, deps.minPressDuration);
  const core = createSourceCore(kind, deps.clock, deps.scheduler, debouncer);
  let machine = INITIAL_KEY_MACHINE_STATE;
  let detach: Unsubscribe[] = [];

  const handler: KeyHandler = {
    keyDown(e) {
      const active = codes();
      if (!active.has(e.code)) return;
      const decision = keyDown(machine, e, active, rule, deps.focus());
      machine = decision.state;
      if (decision.preventDefault) e.preventDefault();
      if (decision.raw === 'down') core.feed((d) => d.rawDown(deps.clock()));
    },
    keyUp(e) {
      const decision = keyUp(machine, e);
      machine = decision.state;
      if (decision.preventDefault) e.preventDefault();
      if (decision.raw === 'up') core.feed((d) => d.rawUp(deps.clock()));
    },
  };

  // Blur and hide (Req 7.1 to 7.4): end or discard the press; its later keyup passes nothing.
  const endPress = (): void => {
    core.endPress();
    machine = abandonActive(machine);
  };

  const source: KeySource = {
    kind,
    start() {
      if (core.status() !== 'off') return;
      machine = INITIAL_KEY_MACHINE_STATE;
      detach = [deps.router.add(handler), deps.page.onBlur(endPress), deps.page.onHidden(endPress)];
      core.setStatus('active');
    },
    stop() {
      if (core.status() === 'off') return;
      endPress();
      for (const remove of detach) remove();
      detach = [];
      machine = INITIAL_KEY_MACHINE_STATE;
      core.setStatus('off');
    },
    status: core.status,
    ...core.subscribers,
    setMinPressDuration: (value) => debouncer.setMinPressDuration(value),
  };

  return {
    source,
    releaseActive() {
      if (machine.active === null) return;
      core.feed((d) => d.rawUp(deps.clock()));
      machine = abandonActive(machine);
    },
  };
}

/** Space, Enter and NumpadEnter key Morse while the focus is a Keying_Target (Req 4). */
export function createKeyboardSource(deps: KeySourceDeps): KeySource {
  return createKeySource(deps, 'keyboard', 'keyboard', () => KEYBOARD_CODES).source;
}
