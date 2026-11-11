/**
 * The Alarm_Machine (design "lib/safety/alarm-machine.ts", Requirement 3): a pure state machine
 * that returns the next state, whether the input was consumed, and its effects as data. No DOM,
 * clock, timer, audio or storage access; inputs are never mutated.
 */

export type AlarmState = 'idle' | 'ringing' | 'closing';
export type AlarmInput = 'start' | 'down' | 'up' | 'partner-dismiss';
export type AlarmEffect =
  | { readonly type: 'show-card' }
  | { readonly type: 'hide-card' }
  | { readonly type: 'start-chime' }
  | { readonly type: 'stop-chime' }
  | { readonly type: 'active-change'; readonly active: boolean };

export interface AlarmStepResult {
  readonly state: AlarmState;
  readonly consumed: boolean;
  readonly effects: readonly AlarmEffect[];
}

const freeze = <T extends object>(value: T): T => Object.freeze(value);

const SHOW_CARD: AlarmEffect = freeze({ type: 'show-card' });
const HIDE_CARD: AlarmEffect = freeze({ type: 'hide-card' });
const START_CHIME: AlarmEffect = freeze({ type: 'start-chime' });
const STOP_CHIME: AlarmEffect = freeze({ type: 'stop-chime' });
const ACTIVE_ON: AlarmEffect = freeze({ type: 'active-change', active: true });
const ACTIVE_OFF: AlarmEffect = freeze({ type: 'active-change', active: false });

const NO_EFFECTS: readonly AlarmEffect[] = freeze([]);
const START_EFFECTS: readonly AlarmEffect[] = freeze([SHOW_CARD, START_CHIME, ACTIVE_ON]);
const DOWN_DISMISS_EFFECTS: readonly AlarmEffect[] = freeze([HIDE_CARD, STOP_CHIME]);
const PARTNER_DISMISS_EFFECTS: readonly AlarmEffect[] = freeze([HIDE_CARD, STOP_CHIME, ACTIVE_OFF]);
const CLOSED_EFFECTS: readonly AlarmEffect[] = freeze([ACTIVE_OFF]);

/** Every result is a frozen constant, so equal inputs return identical objects. */
const result = (state: AlarmState, consumed: boolean, effects: readonly AlarmEffect[]): AlarmStepResult =>
  freeze({ state, consumed, effects });

const IDLE_UNCHANGED = result('idle', false, NO_EFFECTS);
const RINGING_UNCHANGED = result('ringing', false, NO_EFFECTS);
const RINGING_CONSUMED = result('ringing', true, NO_EFFECTS);
const CLOSING_UNCHANGED = result('closing', false, NO_EFFECTS);
const CLOSING_CONSUMED = result('closing', true, NO_EFFECTS);
const STARTED = result('ringing', false, START_EFFECTS);
const DISMISSED_BY_DOWN = result('closing', true, DOWN_DISMISS_EFFECTS);
const DISMISSED_BY_PARTNER = result('idle', false, PARTNER_DISMISS_EFFECTS);
const CLOSED = result('idle', true, CLOSED_EFFECTS);

/** Pure; never throws; never mutates (transition table in the design, Requirements 3.7 and 3.8). */
export function alarmStep(state: AlarmState, input: AlarmInput): AlarmStepResult {
  switch (state) {
    case 'idle':
      return input === 'start' ? STARTED : IDLE_UNCHANGED;
    case 'ringing':
      switch (input) {
        case 'down':
          return DISMISSED_BY_DOWN;
        case 'up':
          return RINGING_CONSUMED;
        case 'partner-dismiss':
          return DISMISSED_BY_PARTNER;
        default:
          return RINGING_UNCHANGED;
      }
    case 'closing':
      switch (input) {
        case 'up':
          return CLOSED;
        case 'down':
          return CLOSING_CONSUMED;
        default:
          return CLOSING_UNCHANGED;
      }
    default:
      // Not an AlarmState: treat it as idle so a bad value can never leave an alarm stuck on.
      return IDLE_UNCHANGED;
  }
}

/** True while the alarm is ringing or closing (Requirement 2.7). */
export const isAlarmActive = (s: AlarmState): boolean => s === 'ringing' || s === 'closing';

/** True when `input` in `state` is a Dismissal: a down or a partner-dismiss while ringing. */
export function isDismissal(state: AlarmState, input: AlarmInput): boolean {
  return state === 'ringing' && (input === 'down' || input === 'partner-dismiss');
}
