import { describe, expect, it } from 'vitest';
import { err, pressEvent, type PressEvent } from '@/lib/input';
import {
  DEFAULT_ENABLED_SOURCES,
  inertAlarmHandler,
  inertUnknownPatternHandler,
  sessionOnlyRouter,
  unavailableLearner,
  type SessionPressTarget,
} from './handlers';

function recordingTarget(): SessionPressTarget & { readonly pressed: PressEvent[]; discards: number } {
  const target = {
    pressed: [] as PressEvent[],
    discards: 0,
    handlePress(event: PressEvent) {
      target.pressed.push(event);
    },
    discardInput() {
      target.discards += 1;
    },
  };
  return target;
}

describe('sessionOnlyRouter', () => {
  it('forwards every event to the connected session in order and never discards', () => {
    const router = sessionOnlyRouter();
    const target = recordingTarget();
    router.connect(target);
    const events = [
      pressEvent('down', 10, 'keyboard'),
      pressEvent('up', 90, 'keyboard'),
      pressEvent('down', 300, 'pointer'),
      pressEvent('up', 560, 'pointer'),
    ];
    for (const event of events) router.route(event);
    expect(target.pressed).toEqual(events);
    expect(target.discards).toBe(0);
  });

  it('forwards nothing after the returned disconnect runs, or before connect', () => {
    const router = sessionOnlyRouter();
    const target = recordingTarget();
    router.route(pressEvent('down', 1, 'switch'));
    const disconnect = router.connect(target);
    router.route(pressEvent('down', 5, 'switch'));
    disconnect();
    router.route(pressEvent('up', 9, 'switch'));
    expect(target.pressed).toEqual([pressEvent('down', 5, 'switch')]);
  });

  it('a stale disconnect does not cut off a newer connection', () => {
    const router = sessionOnlyRouter();
    const first = recordingTarget();
    const second = recordingTarget();
    const disconnectFirst = router.connect(first);
    router.connect(second);
    disconnectFirst();
    router.route(pressEvent('down', 3, 'keyboard'));
    expect(first.pressed).toEqual([]);
    expect(second.pressed).toEqual([pressEvent('down', 3, 'keyboard')]);
  });
});

describe('DEFAULT_ENABLED_SOURCES', () => {
  it('turns on keyboard, switch and pointer, keeps blink off, and is frozen', () => {
    expect(DEFAULT_ENABLED_SOURCES).toEqual({ keyboard: true, switch: true, pointer: true, blink: false });
    expect(Object.isFrozen(DEFAULT_ENABLED_SOURCES)).toBe(true);
  });
});

describe('unavailableLearner', () => {
  it('never arms and fails arm() and clear() with "not available"', async () => {
    const learner = unavailableLearner();
    expect(learner.isArmed()).toBe(false);
    const armed = learner.arm();
    expect(learner.isArmed()).toBe(false);
    expect(await armed).toEqual(err({ reason: 'cancelled', message: 'not available' }));
    expect(learner.clear()).toEqual(err({ reason: 'save-failed', message: 'not available' }));
    expect(() => learner.cancel()).not.toThrow();
    expect(learner.isArmed()).toBe(false);
  });
});

describe('inert handlers', () => {
  it('the inert alarm is never active and ignores start, presses and listeners', () => {
    const alarm = inertAlarmHandler();
    const seen: boolean[] = [];
    const unsubscribe = alarm.onActiveChange((active) => seen.push(active));
    alarm.start();
    alarm.handlePress(pressEvent('down', 1, 'keyboard'));
    expect(alarm.isActive()).toBe(false);
    expect(seen).toEqual([]);
    expect(() => unsubscribe()).not.toThrow();
  });

  it('the inert unknown-pattern handler accepts any pattern', () => {
    expect(() => inertUnknownPatternHandler().handle('......')).not.toThrow();
  });
});
