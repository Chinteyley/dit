import { describe, expect, it } from 'vitest';
import { INITIAL_ARBITER_STATE, arbiterStep, createArbiter, safeTickTime } from './arbiter';
import { createManualClock } from './clock';
import { collect, createFakePressSource, plain } from './test-support';
import { pressEvent, type PressEvent } from './types';

function connected(kinds: readonly ('keyboard' | 'switch' | 'pointer' | 'blink')[]) {
  const clock = createManualClock(0);
  const arbiter = createArbiter(clock.now);
  const out = collect<PressEvent>();
  arbiter.onOutput(out.listener);
  const sources = kinds.map((kind) => createFakePressSource(kind));
  const disconnect = sources.map((source) => {
    const result = arbiter.connect(source);
    if (!result.ok) throw new Error(result.error.message);
    return result.value;
  });
  return { clock, arbiter, out, sources, disconnect };
}

describe('arbiterStep', () => {
  it('passes the first down through as the same object and becomes Held', () => {
    const down = pressEvent('down', 10, 'pointer');
    const step = arbiterStep(INITIAL_ARBITER_STATE, { type: 'event', event: down });
    expect(step.out).toBe(down);
    expect(step.state).toStrictEqual({ holder: 'pointer', lastT: 10, marks: [] });
  });

  it('marks another source that presses while Held and drops its next up', () => {
    let state = arbiterStep(INITIAL_ARBITER_STATE, { type: 'event', event: pressEvent('down', 10, 'pointer') }).state;
    state = arbiterStep(state, { type: 'event', event: pressEvent('down', 20, 'keyboard') }).state;
    state = arbiterStep(state, { type: 'event', event: pressEvent('down', 25, 'keyboard') }).state;
    expect(state.marks).toStrictEqual(['keyboard']);

    const keyboardUp = arbiterStep(state, { type: 'event', event: pressEvent('up', 30, 'keyboard') });
    expect(keyboardUp.out).toBeNull();
    expect(keyboardUp.state.marks).toStrictEqual([]);
    expect(keyboardUp.state.holder).toBe('pointer');
  });

  it('keeps marks sorted in SOURCE_KINDS order', () => {
    let state = arbiterStep(INITIAL_ARBITER_STATE, { type: 'event', event: pressEvent('down', 0, 'switch') }).state;
    state = arbiterStep(state, { type: 'event', event: pressEvent('down', 1, 'blink') }).state;
    state = arbiterStep(state, { type: 'event', event: pressEvent('down', 2, 'keyboard') }).state;
    state = arbiterStep(state, { type: 'event', event: pressEvent('down', 3, 'pointer') }).state;
    expect(state.marks).toStrictEqual(['keyboard', 'pointer', 'blink']);
  });

  it('raises a stale up from the Holder to the last output time (Req 2.7)', () => {
    const held = arbiterStep(INITIAL_ARBITER_STATE, { type: 'event', event: pressEvent('down', 100, 'blink') }).state;
    const step = arbiterStep(held, { type: 'event', event: pressEvent('up', 60, 'blink') });
    expect(step.out).toStrictEqual(pressEvent('up', 100, 'blink'));
    expect(step.state).toStrictEqual({ holder: null, lastT: 100, marks: [] });
  });

  it('detach of the Holder emits one up at max(now, lastT), or lastT for a non-finite now', () => {
    const held = arbiterStep(INITIAL_ARBITER_STATE, { type: 'event', event: pressEvent('down', 100, 'switch') }).state;
    expect(arbiterStep(held, { type: 'detach', source: 'switch', now: 250 }).out).toStrictEqual(
      pressEvent('up', 250, 'switch'),
    );
    expect(arbiterStep(held, { type: 'detach', source: 'switch', now: 40 }).out).toStrictEqual(
      pressEvent('up', 100, 'switch'),
    );
    expect(arbiterStep(held, { type: 'detach', source: 'switch', now: Number.NaN }).out).toStrictEqual(
      pressEvent('up', 100, 'switch'),
    );
  });

  it('detach of a marked source clears its mark and emits nothing (Req 2.10)', () => {
    let state = arbiterStep(INITIAL_ARBITER_STATE, { type: 'event', event: pressEvent('down', 0, 'switch') }).state;
    state = arbiterStep(state, { type: 'event', event: pressEvent('down', 1, 'pointer') }).state;
    const step = arbiterStep(state, { type: 'detach', source: 'pointer', now: 5 });
    expect(step.out).toBeNull();
    expect(step.state).toStrictEqual({ holder: 'switch', lastT: 0, marks: [] });
  });
});

describe('safeTickTime', () => {
  it('never passes the earliest pending Raw_Down', () => {
    expect(safeTickTime(500, null)).toBe(500);
    expect(safeTickTime(500, 420)).toBe(420);
    expect(safeTickTime(500, 500)).toBe(500);
    expect(safeTickTime(300, 420)).toBe(300);
  });
});

describe('createArbiter', () => {
  it('a Holder that stops emits its own up, then off adds no second up (Req 2.9)', () => {
    const { clock, out, sources } = connected(['keyboard']);
    const [keyboard] = sources;
    keyboard?.emit(pressEvent('down', 10, 'keyboard'));
    clock.set(80);
    keyboard?.emit(pressEvent('up', 80, 'keyboard'));
    keyboard?.report('off');
    expect(plain(out.values)).toStrictEqual([
      { kind: 'down', t: 10, source: 'keyboard' },
      { kind: 'up', t: 80, source: 'keyboard' },
    ]);
  });

  it('a Holder that reports off or a failure without its up gets one up at the clock', () => {
    const { clock, arbiter, out, sources } = connected(['blink', 'keyboard']);
    const [blink] = sources;
    blink?.emit(pressEvent('down', 10, 'blink'));
    clock.set(300);
    blink?.report('error');
    expect(plain(out.values)).toStrictEqual([
      { kind: 'down', t: 10, source: 'blink' },
      { kind: 'up', t: 300, source: 'blink' },
    ]);
    expect(arbiter.isHeld()).toBe(false);
  });

  it('disconnecting the Holder while Held emits one up and removes its subscriptions', () => {
    const { clock, arbiter, out, sources, disconnect } = connected(['pointer', 'switch']);
    const [pointer] = sources;
    pointer?.emit(pressEvent('down', 50, 'pointer'));
    expect(arbiter.holder()).toBe('pointer');
    clock.set(90);
    disconnect[0]?.();
    disconnect[0]?.();
    expect(plain(out.values)).toStrictEqual([
      { kind: 'down', t: 50, source: 'pointer' },
      { kind: 'up', t: 90, source: 'pointer' },
    ]);
    expect(pointer?.listenerCount()).toBe(0);
    pointer?.emit(pressEvent('down', 100, 'pointer'));
    expect(out.values).toHaveLength(2);
  });

  it('refuses a second source of the same kind until the first disconnects', () => {
    const { arbiter, disconnect } = connected(['keyboard']);
    const second = createFakePressSource('keyboard');
    const refused = arbiter.connect(second);
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.error.kind).toBe('keyboard');
      expect(refused.error.message).toContain('keyboard');
    }
    expect(second.listenerCount()).toBe(0);
    disconnect[0]?.();
    expect(arbiter.connect(second).ok).toBe(true);
  });

  it('a throwing output listener does not block the others', () => {
    const { arbiter, out, sources } = connected(['switch']);
    const after = collect<PressEvent>();
    arbiter.onOutput(() => {
      throw new Error('listener failure');
    });
    arbiter.onOutput(after.listener);
    sources[0]?.emit(pressEvent('down', 1, 'switch'));
    expect(out.values).toHaveLength(1);
    expect(after.values).toHaveLength(1);
  });

  it('a listener unsubscribed during delivery gets nothing further', () => {
    const { arbiter, sources } = connected(['switch']);
    const second = collect<PressEvent>();
    let stopSecond = (): void => undefined;
    arbiter.onOutput(() => stopSecond());
    stopSecond = arbiter.onOutput(second.listener);
    sources[0]?.emit(pressEvent('down', 1, 'switch'));
    sources[0]?.emit(pressEvent('up', 2, 'switch'));
    expect(second.values).toHaveLength(0);
  });

  it('delivers events caused by a listener after the current event, to every listener in order', () => {
    const { arbiter, sources } = connected(['switch', 'pointer']);
    const seenA: string[] = [];
    const seenB: string[] = [];
    arbiter.onOutput((event) => {
      seenA.push(`${event.kind}@${event.t}`);
      if (event.kind === 'down') sources[0]?.emit(pressEvent('up', event.t + 5, 'switch'));
    });
    arbiter.onOutput((event) => seenB.push(`${event.kind}@${event.t}`));
    sources[0]?.emit(pressEvent('down', 10, 'switch'));
    expect(seenA).toStrictEqual(['down@10', 'up@15']);
    expect(seenB).toStrictEqual(['down@10', 'up@15']);
  });

  it('reports the earliest pending Raw_Down and notifies only on change', () => {
    const { arbiter, sources, disconnect } = connected(['keyboard', 'pointer']);
    const changes = collect<number | null>();
    arbiter.onPendingChange(changes.listener);
    const [keyboard, pointer] = sources;

    keyboard?.setPending(500);
    pointer?.setPending(450);
    pointer?.setPending(450);
    keyboard?.setPending(470);
    expect(arbiter.pendingSince()).toBe(450);
    pointer?.setPending(null);
    expect(arbiter.pendingSince()).toBe(470);
    disconnect[0]?.();
    expect(arbiter.pendingSince()).toBeNull();
    expect(changes.values).toStrictEqual([500, 450, 470, null]);
  });
});
