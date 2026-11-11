import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MIN_PRESS,
  MIN_PRESS_RANGES,
  createDebouncer,
  debounceStep,
  validateMinPressDuration,
  type DebounceInput,
  type DebounceState,
} from './debounce';
import { plain } from './test-support';
import { SOURCE_KINDS } from './types';

const idle: DebounceState = { phase: 'idle' };
const pending: DebounceState = { phase: 'pending', downT: 100, min: 30 };
const confirmed: DebounceState = { phase: 'confirmed', downT: 100 };

function step(state: DebounceState, input: DebounceInput, min = 30) {
  const result = debounceStep(state, input, 'keyboard', min);
  return { state: result.state, events: plain(result.events) };
}

describe('debounceStep transition table', () => {
  it('idle + rawDown with min 0 confirms and emits down synchronously (Req 3.7)', () => {
    expect(step(idle, { type: 'rawDown', t: 100 }, 0)).toStrictEqual({
      state: { phase: 'confirmed', downT: 100 },
      events: [{ kind: 'down', t: 100, source: 'keyboard' }],
    });
  });

  it('idle + rawDown with min > 0 records a Pending_Press and emits nothing (Req 3.2)', () => {
    expect(step(idle, { type: 'rawDown', t: 100 })).toStrictEqual({ state: pending, events: [] });
  });

  it('pending + advance at the deadline confirms with down at the Raw_Down time (Req 3.3)', () => {
    expect(step(pending, { type: 'advance', now: 130 })).toStrictEqual({
      state: confirmed,
      events: [{ kind: 'down', t: 100, source: 'keyboard' }],
    });
  });

  it('pending + advance before the deadline changes nothing', () => {
    expect(step(pending, { type: 'advance', now: 129 })).toStrictEqual({ state: pending, events: [] });
  });

  it('pending + rawUp at or past the deadline emits down then up (Req 3.6)', () => {
    expect(step(pending, { type: 'rawUp', t: 130 })).toStrictEqual({
      state: idle,
      events: [
        { kind: 'down', t: 100, source: 'keyboard' },
        { kind: 'up', t: 130, source: 'keyboard' },
      ],
    });
  });

  it('pending + short rawUp discards the press (Req 3.4)', () => {
    expect(step(pending, { type: 'rawUp', t: 129 })).toStrictEqual({ state: idle, events: [] });
  });

  it('pending + rawUp before the Raw_Down counts as a 0 ms press (Req 3.11)', () => {
    expect(step(pending, { type: 'rawUp', t: 40 })).toStrictEqual({ state: idle, events: [] });
    const zeroMinPending: DebounceState = { phase: 'pending', downT: 100, min: 0 };
    expect(step(zeroMinPending, { type: 'rawUp', t: 40 }).events).toStrictEqual([
      { kind: 'down', t: 100, source: 'keyboard' },
      { kind: 'up', t: 100, source: 'keyboard' },
    ]);
  });

  it('confirmed + rawUp emits up at max(t, downT) (Req 3.5, 3.11)', () => {
    expect(step(confirmed, { type: 'rawUp', t: 400 })).toStrictEqual({
      state: idle,
      events: [{ kind: 'up', t: 400, source: 'keyboard' }],
    });
    expect(step(confirmed, { type: 'rawUp', t: 50 }).events).toStrictEqual([{ kind: 'up', t: 100, source: 'keyboard' }]);
  });

  it('rawDown while pending or confirmed is ignored and keeps the original Raw_Down (Req 3.9)', () => {
    expect(step(pending, { type: 'rawDown', t: 110 })).toStrictEqual({ state: pending, events: [] });
    expect(step(confirmed, { type: 'rawDown', t: 110 })).toStrictEqual({ state: confirmed, events: [] });
  });

  it('idle ignores rawUp, advance, cancel and forceUp (Req 3.10, 7.8)', () => {
    const inputs: DebounceInput[] = [
      { type: 'rawUp', t: 10 },
      { type: 'advance', now: 10 },
      { type: 'cancel' },
      { type: 'forceUp', now: 10 },
    ];
    for (const input of inputs) {
      expect(step(idle, input)).toStrictEqual({ state: idle, events: [] });
    }
  });

  it('pending + cancel or forceUp drops the press silently (Req 1.4, 7.3)', () => {
    expect(step(pending, { type: 'cancel' })).toStrictEqual({ state: idle, events: [] });
    expect(step(pending, { type: 'forceUp', now: 500 })).toStrictEqual({ state: idle, events: [] });
  });

  it('confirmed + forceUp emits up at max(now, downT)', () => {
    expect(step(confirmed, { type: 'forceUp', now: 700 })).toStrictEqual({
      state: idle,
      events: [{ kind: 'up', t: 700, source: 'keyboard' }],
    });
    expect(step(confirmed, { type: 'forceUp', now: 20 }).events).toStrictEqual([{ kind: 'up', t: 100, source: 'keyboard' }]);
  });

  it('confirmed + cancel keeps the press', () => {
    expect(step(confirmed, { type: 'cancel' })).toStrictEqual({ state: confirmed, events: [] });
  });

  it('ignores inputs with a non-finite time in every state', () => {
    for (const state of [idle, pending, confirmed]) {
      for (const bad of [Number.NaN, Infinity, -Infinity]) {
        const inputs: DebounceInput[] = [
          { type: 'rawDown', t: bad },
          { type: 'rawUp', t: bad },
          { type: 'advance', now: bad },
          { type: 'forceUp', now: bad },
        ];
        for (const input of inputs) {
          const result = debounceStep(state, input, 'pointer', 30);
          expect(result.state).toBe(state);
          expect(result.events).toStrictEqual([]);
        }
      }
    }
  });

  it('tags events with the given kind', () => {
    const { events } = debounceStep(confirmed, { type: 'rawUp', t: 300 }, 'blink', 200);
    expect(events.map((event) => event.source)).toStrictEqual(['blink']);
  });
});

describe('Min_Press_Duration settings', () => {
  it('has the documented defaults and ranges', () => {
    expect(DEFAULT_MIN_PRESS).toStrictEqual({ keyboard: 30, switch: 30, pointer: 30, blink: 200 });
    expect(MIN_PRESS_RANGES).toStrictEqual({
      keyboard: { min: 0, max: 500 },
      switch: { min: 0, max: 500 },
      pointer: { min: 0, max: 500 },
      blink: { min: 50, max: 2000 },
    });
  });

  it('starts each kind at its default', () => {
    for (const kind of SOURCE_KINDS) {
      expect(createDebouncer(kind).minPressDuration()).toBe(DEFAULT_MIN_PRESS[kind]);
    }
  });

  it('falls back to the default for an invalid initial value', () => {
    expect(createDebouncer('blink', 10).minPressDuration()).toBe(200);
    expect(createDebouncer('keyboard', Number.NaN).minPressDuration()).toBe(30);
    expect(createDebouncer('pointer', 0).minPressDuration()).toBe(0);
  });

  it('accepts the inclusive range ends and rejects values outside', () => {
    expect(validateMinPressDuration('keyboard', 0)).toStrictEqual({ ok: true, value: 0 });
    expect(validateMinPressDuration('keyboard', 500)).toStrictEqual({ ok: true, value: 500 });
    expect(validateMinPressDuration('blink', 50)).toStrictEqual({ ok: true, value: 50 });
    expect(validateMinPressDuration('blink', 2000)).toStrictEqual({ ok: true, value: 2000 });
    expect(validateMinPressDuration('switch', -0)).toStrictEqual({ ok: true, value: 0 });

    const tooLong = validateMinPressDuration('switch', 501);
    expect(tooLong).toStrictEqual({
      ok: false,
      error: {
        source: 'switch',
        setting: 'minPressDuration',
        value: 501,
        message: 'The switch minimum press must be a number from 0 to 500 ms.',
      },
    });
    expect(validateMinPressDuration('blink', 49).ok).toBe(false);
    expect(validateMinPressDuration('pointer', '30').ok).toBe(false);
    expect(validateMinPressDuration('pointer', Infinity).ok).toBe(false);
  });

  it('keeps the previous value when a setting is rejected', () => {
    const debouncer = createDebouncer('pointer');
    expect(debouncer.setMinPressDuration(120)).toStrictEqual({ ok: true, value: 120 });
    expect(debouncer.setMinPressDuration(900).ok).toBe(false);
    expect(debouncer.minPressDuration()).toBe(120);
  });
});

describe('createDebouncer', () => {
  it('emits down synchronously with a 0 ms setting', () => {
    const debouncer = createDebouncer('keyboard', 0);
    expect(plain(debouncer.rawDown(10))).toStrictEqual([{ kind: 'down', t: 10, source: 'keyboard' }]);
    expect(debouncer.isHeld()).toBe(true);
    expect(debouncer.pendingSince()).toBeNull();
  });

  it('reports the pending press and its deadline', () => {
    const debouncer = createDebouncer('switch', 40);
    expect(debouncer.rawDown(1000)).toStrictEqual([]);
    expect(debouncer.pendingSince()).toBe(1000);
    expect(debouncer.deadline()).toBe(1040);
    expect(debouncer.isHeld()).toBe(false);

    expect(plain(debouncer.advance(1040))).toStrictEqual([{ kind: 'down', t: 1000, source: 'switch' }]);
    expect(debouncer.pendingSince()).toBeNull();
    expect(debouncer.deadline()).toBeNull();
    expect(debouncer.isHeld()).toBe(true);
  });

  it('cancel drops only a pending press', () => {
    const debouncer = createDebouncer('pointer', 30);
    debouncer.rawDown(0);
    debouncer.cancel();
    expect(debouncer.state()).toStrictEqual({ phase: 'idle' });
    expect(debouncer.rawUp(100)).toStrictEqual([]);

    debouncer.rawDown(200);
    debouncer.advance(230);
    debouncer.cancel();
    expect(debouncer.isHeld()).toBe(true);
    expect(plain(debouncer.rawUp(300))).toStrictEqual([{ kind: 'up', t: 300, source: 'pointer' }]);
  });

  it('forceUp ends a held press at max(now, downT) and emits nothing afterwards', () => {
    const debouncer = createDebouncer('keyboard', 0);
    debouncer.rawDown(500);
    expect(plain(debouncer.forceUp(450))).toStrictEqual([{ kind: 'up', t: 500, source: 'keyboard' }]);
    expect(debouncer.forceUp(600)).toStrictEqual([]);
    expect(debouncer.rawUp(700)).toStrictEqual([]);
  });

  it('applies a new setting from the next Raw_Down', () => {
    const debouncer = createDebouncer('keyboard', 100);
    debouncer.rawDown(0);
    debouncer.setMinPressDuration(10);
    expect(debouncer.advance(50)).toStrictEqual([]);
    expect(debouncer.rawUp(60)).toStrictEqual([]);

    debouncer.rawDown(1000);
    expect(plain(debouncer.advance(1010))).toStrictEqual([{ kind: 'down', t: 1000, source: 'keyboard' }]);
  });

  it('returns frozen events with exactly three fields', () => {
    const [event] = createDebouncer('blink', 50).rawUp(0).concat(createDebouncer('pointer', 0).rawDown(3));
    expect(event).toBeDefined();
    expect(Object.isFrozen(event)).toBe(true);
    expect(Object.keys(event ?? {}).sort()).toStrictEqual(['kind', 'source', 't']);
  });
});
