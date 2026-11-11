import type { FocusClass } from './focus';

/**
 * keyboard: handle only when the focus classifies as 'keying' (Req 4.1, 4.6).
 * switch: handle unless the focus classifies as 'editable' (Req 4.9, 5.9, 5.11).
 */
export type FocusRule = 'keyboard' | 'switch';

export interface KeyMachineState {
  /** Code holding the current raw press. */
  readonly active: string | null;
  /** Codes whose keydown was ignored; their keyup passes no Raw_Up (Req 4.7). */
  readonly ignored: ReadonlyMap<string, { readonly preventDefaultOnUp: boolean }>;
}

export interface KeyDecision {
  readonly state: KeyMachineState;
  readonly raw: 'down' | 'up' | null;
  readonly preventDefault: boolean;
}

export const INITIAL_KEY_MACHINE_STATE: KeyMachineState = Object.freeze({
  active: null,
  ignored: new Map<string, { readonly preventDefaultOnUp: boolean }>(),
});

export function focusAllowed(rule: FocusRule, focus: FocusClass): boolean {
  return rule === 'keyboard' ? focus === 'keying' : focus !== 'editable';
}

function withIgnored(s: KeyMachineState, code: string, preventDefaultOnUp: boolean): KeyMachineState {
  const ignored = new Map(s.ignored);
  ignored.set(code, { preventDefaultOnUp });
  return { active: s.active, ignored };
}

/**
 * The keydown decision table of the design, for codes in `codes`; other codes pass through
 * untouched. A non-repeat keydown for the code already holding the press (a lost repeat flag) is
 * handled like a repeat of that key (Req 4.3).
 */
export function keyDown(
  s: KeyMachineState,
  ev: { readonly code: string; readonly repeat: boolean },
  codes: ReadonlySet<string>,
  rule: FocusRule,
  focus: FocusClass,
): KeyDecision {
  if (!codes.has(ev.code)) {
    return { state: s, raw: null, preventDefault: false };
  }
  const allowed = focusAllowed(rule, focus);
  if (ev.code === s.active) {
    return { state: s, raw: null, preventDefault: true };
  }
  if (ev.repeat) {
    return { state: s, raw: null, preventDefault: allowed };
  }
  if (!allowed) {
    return { state: withIgnored(s, ev.code, false), raw: null, preventDefault: false };
  }
  if (s.active !== null) {
    return { state: withIgnored(s, ev.code, true), raw: null, preventDefault: true };
  }
  return { state: { active: ev.code, ignored: s.ignored }, raw: 'down', preventDefault: true };
}

/** The active key's keyup ends the press whatever the focus (Req 4.2); an ignored key's keyup passes nothing (Req 4.7). */
export function keyUp(s: KeyMachineState, ev: { readonly code: string }): KeyDecision {
  if (ev.code === s.active) {
    return { state: { active: null, ignored: s.ignored }, raw: 'up', preventDefault: true };
  }
  const entry = s.ignored.get(ev.code);
  if (entry !== undefined) {
    const ignored = new Map(s.ignored);
    ignored.delete(ev.code);
    return { state: { active: s.active, ignored }, raw: null, preventDefault: entry.preventDefaultOnUp };
  }
  return { state: s, raw: null, preventDefault: false };
}

/** Blur, hide, stop, or switch-key change: forget the active press, so its later keyup passes nothing (Req 7.4, 5.13). */
export function abandonActive(s: KeyMachineState): KeyMachineState {
  return s.active === null ? s : { active: null, ignored: s.ignored };
}
