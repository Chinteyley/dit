import { describe, expect, it } from 'vitest';
import { alarmStep, isAlarmActive, isDismissal, type AlarmEffect, type AlarmInput, type AlarmState } from './alarm-machine';

interface Row {
  readonly state: AlarmState;
  readonly input: AlarmInput;
  readonly next: AlarmState;
  readonly consumed: boolean;
  readonly effects: readonly AlarmEffect[];
}

const SHOW: AlarmEffect = { type: 'show-card' };
const HIDE: AlarmEffect = { type: 'hide-card' };
const CHIME_ON: AlarmEffect = { type: 'start-chime' };
const CHIME_OFF: AlarmEffect = { type: 'stop-chime' };
const ON: AlarmEffect = { type: 'active-change', active: true };
const OFF: AlarmEffect = { type: 'active-change', active: false };

/** The design's transition table, one row per (state, input) pair. */
const TABLE: readonly Row[] = [
  { state: 'idle', input: 'start', next: 'ringing', consumed: false, effects: [SHOW, CHIME_ON, ON] },
  { state: 'idle', input: 'down', next: 'idle', consumed: false, effects: [] },
  { state: 'idle', input: 'up', next: 'idle', consumed: false, effects: [] },
  { state: 'idle', input: 'partner-dismiss', next: 'idle', consumed: false, effects: [] },
  { state: 'ringing', input: 'down', next: 'closing', consumed: true, effects: [HIDE, CHIME_OFF] },
  { state: 'ringing', input: 'up', next: 'ringing', consumed: true, effects: [] },
  { state: 'ringing', input: 'partner-dismiss', next: 'idle', consumed: false, effects: [HIDE, CHIME_OFF, OFF] },
  { state: 'ringing', input: 'start', next: 'ringing', consumed: false, effects: [] },
  { state: 'closing', input: 'up', next: 'idle', consumed: true, effects: [OFF] },
  { state: 'closing', input: 'down', next: 'closing', consumed: true, effects: [] },
  { state: 'closing', input: 'start', next: 'closing', consumed: false, effects: [] },
  { state: 'closing', input: 'partner-dismiss', next: 'closing', consumed: false, effects: [] },
];

describe('alarmStep', () => {
  it.each(TABLE)('$state + $input → $next (consumed $consumed)', ({ state, input, next, consumed, effects }) => {
    const out = alarmStep(state, input);
    expect(out.state).toBe(next);
    expect(out.consumed).toBe(consumed);
    expect(out.effects).toEqual(effects);
  });

  it('covers every state and input pair exactly once', () => {
    const pairs = new Set(TABLE.map((row) => `${row.state}/${row.input}`));
    expect(pairs.size).toBe(12);
  });

  it('returns frozen results, identical for equal inputs', () => {
    const a = alarmStep('idle', 'start');
    expect(alarmStep('idle', 'start')).toBe(a);
    expect(Object.isFrozen(a)).toBe(true);
    expect(Object.isFrozen(a.effects)).toBe(true);
    expect(a.effects.every((effect) => Object.isFrozen(effect))).toBe(true);
  });
});

describe('isAlarmActive and isDismissal', () => {
  it('is active while ringing or closing only (Requirement 2.7)', () => {
    expect(isAlarmActive('idle')).toBe(false);
    expect(isAlarmActive('ringing')).toBe(true);
    expect(isAlarmActive('closing')).toBe(true);
  });

  it('counts a down or a partner-dismiss while ringing as the Dismissal', () => {
    expect(isDismissal('ringing', 'down')).toBe(true);
    expect(isDismissal('ringing', 'partner-dismiss')).toBe(true);
    expect(isDismissal('ringing', 'up')).toBe(false);
    expect(isDismissal('ringing', 'start')).toBe(false);
    expect(isDismissal('closing', 'down')).toBe(false);
    expect(isDismissal('idle', 'partner-dismiss')).toBe(false);
  });
});
