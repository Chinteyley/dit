import { describe, expect, it } from 'vitest';
import { createManualClock, createManualScheduler } from './clock';
import { createDebouncer } from './debounce';
import { createSourceCore } from './source-base';
import { collect, plain } from './test-support';
import type { PressEvent, SourceStatus } from './types';

function setup(min = 30, withClockScheduler = true) {
  const clock = createManualClock(1000);
  const scheduler = createManualScheduler(withClockScheduler ? clock.now : undefined);
  const core = createSourceCore('keyboard', clock.now, scheduler, createDebouncer('keyboard', min));
  const presses = collect<PressEvent>();
  core.subscribers.onPress(presses.listener);
  return { clock, scheduler, core, presses };
}

describe('createSourceCore delivery', () => {
  it('stops delivering to a listener that unsubscribes during delivery, and keeps the others (Req 1.10)', () => {
    const { core } = setup(0);
    const seen: string[] = [];
    let stopA = (): void => undefined;
    stopA = core.subscribers.onPress((event) => {
      seen.push(`a:${event.kind}`);
      stopA();
    });
    core.subscribers.onPress((event) => seen.push(`b:${event.kind}`));
    core.feed((d) => [...d.rawDown(1000), ...d.rawUp(1100)]);
    expect(seen).toStrictEqual(['a:down', 'b:down', 'b:up']);
  });

  it('a listener unsubscribed by another listener mid-delivery is not called', () => {
    const { core } = setup(0);
    const seen: string[] = [];
    let stopB = (): void => undefined;
    core.subscribers.onPress(() => {
      seen.push('a');
      stopB();
    });
    stopB = core.subscribers.onPress(() => seen.push('b'));
    core.feed((d) => d.rawDown(1000));
    expect(seen).toStrictEqual(['a']);
  });

  it('a throwing subscriber does not stop the others (Req 10.10)', () => {
    const { core, presses } = setup(0);
    core.subscribers.onPress(() => {
      throw new Error('subscriber failure');
    });
    const after = collect<PressEvent>();
    core.subscribers.onPress(after.listener);
    core.subscribers.onStatus(() => {
      throw new Error('status subscriber failure');
    });
    expect(() => core.setStatus('active')).not.toThrow();
    core.feed((d) => d.rawDown(1000));
    expect(presses.values).toHaveLength(1);
    expect(after.values).toHaveLength(1);
  });

  it('delivers a status once and never repeats an unchanged status (Req 1.7)', () => {
    const { core } = setup();
    const statuses = collect<SourceStatus>();
    core.subscribers.onStatus(statuses.listener);
    core.setStatus('active');
    core.setStatus('active');
    core.setStatus('off');
    core.setStatus('off');
    expect(statuses.values).toStrictEqual(['active', 'off']);
    expect(core.status()).toBe('off');
  });

  it('keeps an up before a status reported from inside a press listener', () => {
    const { core } = setup(0);
    const order: string[] = [];
    core.subscribers.onStatus((status) => order.push(`status:${status}`));
    core.subscribers.onPress((event) => {
      order.push(`press:${event.kind}`);
      if (event.kind === 'down') {
        core.endPress();
        core.setStatus('off');
      }
    });
    core.setStatus('active');
    core.feed((d) => d.rawDown(1000));
    expect(order).toStrictEqual(['status:active', 'press:down', 'press:up', 'status:off']);
  });
});

describe('createSourceCore confirmation timer', () => {
  it('schedules one timer for the deadline and confirms when it fires', () => {
    const { clock, scheduler, core, presses } = setup(30);
    core.feed((d) => d.rawDown(clock.now()));
    expect(scheduler.pending()).toBe(1);
    expect(core.subscribers.pendingSince()).toBe(1000);

    clock.set(1030);
    scheduler.runDue(1030);
    expect(plain(presses.values)).toStrictEqual([{ kind: 'down', t: 1000, source: 'keyboard' }]);
    expect(scheduler.pending()).toBe(0);
    expect(core.subscribers.pendingSince()).toBeNull();
  });

  it('reschedules when the timer fires early', () => {
    // Without a clock the manual scheduler measures from its last runDue (0), so this timer fires early.
    const { clock, scheduler, core, presses } = setup(30, false);
    core.feed((d) => d.rawDown(clock.now()));
    clock.set(1010);
    scheduler.runDue(1010);
    expect(presses.values).toStrictEqual([]);
    expect(scheduler.pending()).toBe(1);

    clock.set(1030);
    scheduler.runDue(1030);
    expect(plain(presses.values)).toStrictEqual([{ kind: 'down', t: 1000, source: 'keyboard' }]);
    expect(scheduler.pending()).toBe(0);
  });

  it('cancels the timer when the press leaves pending', () => {
    const { clock, scheduler, core } = setup(30);
    core.feed((d) => d.rawDown(clock.now()));
    core.feed((d) => d.rawUp(1010));
    expect(scheduler.pending()).toBe(0);
  });

  it('uses no timer without a scheduler', () => {
    const clock = createManualClock(0);
    const core = createSourceCore('blink', clock.now, null, createDebouncer('blink', 200));
    core.feed((d) => d.rawDown(0));
    expect(core.subscribers.pendingSince()).toBe(0);
  });

  it('notifies pending listeners on each change, after the press events', () => {
    const { clock, scheduler, core } = setup(30);
    const order: string[] = [];
    core.subscribers.onPending((since) => order.push(`pending:${since}`));
    core.subscribers.onPress((event) => order.push(`press:${event.kind}`));
    core.feed((d) => d.rawDown(clock.now()));
    clock.set(1030);
    scheduler.runDue(1030);
    expect(order).toStrictEqual(['pending:1000', 'press:down', 'pending:null']);
  });
});

describe('createSourceCore endPress', () => {
  it('ends a held press once at the clock and does nothing the second time (Req 7.7)', () => {
    const { clock, core, presses } = setup(0);
    core.feed((d) => d.rawDown(1000));
    clock.set(1500);
    core.endPress();
    core.endPress();
    expect(plain(presses.values)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'keyboard' },
      { kind: 'up', t: 1500, source: 'keyboard' },
    ]);
  });

  it('discards a pending press without events and cancels its timer', () => {
    const { clock, scheduler, core, presses } = setup(30);
    core.feed((d) => d.rawDown(clock.now()));
    core.endPress();
    expect(presses.values).toStrictEqual([]);
    expect(scheduler.pending()).toBe(0);
    expect(core.subscribers.pendingSince()).toBeNull();
  });

  it('leaves the status unchanged (Req 7.5)', () => {
    const { core } = setup(0);
    core.setStatus('active');
    core.feed((d) => d.rawDown(1000));
    core.endPress();
    expect(core.status()).toBe('active');
  });
});
