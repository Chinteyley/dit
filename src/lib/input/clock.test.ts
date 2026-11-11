import { describe, expect, it } from 'vitest';
import { createManualClock, createManualScheduler } from './clock';

describe('createManualClock', () => {
  it('starts at the given time and moves only when told to', () => {
    const clock = createManualClock(10);
    expect(clock.now()).toBe(10);
    clock.advance(5);
    expect(clock.now()).toBe(15);
    clock.set(3);
    expect(clock.now()).toBe(3);
    expect(createManualClock().now()).toBe(0);
  });
});

describe('createManualScheduler', () => {
  it('fires due callbacks in due order, ties in scheduling order', () => {
    const scheduler = createManualScheduler();
    const fired: string[] = [];
    scheduler.schedule(30, () => fired.push('c'));
    scheduler.schedule(10, () => fired.push('a'));
    scheduler.schedule(30, () => fired.push('d'));
    scheduler.schedule(20, () => fired.push('b'));
    scheduler.schedule(50, () => fired.push('late'));

    scheduler.runDue(30);
    expect(fired).toStrictEqual(['a', 'b', 'c', 'd']);
    expect(scheduler.pending()).toBe(1);

    scheduler.runDue(49);
    expect(fired).toHaveLength(4);
    scheduler.runDue(50);
    expect(fired.at(-1)).toBe('late');
    expect(scheduler.pending()).toBe(0);
  });

  it('cancel removes a timer and is safe to call twice or after firing', () => {
    const scheduler = createManualScheduler();
    const fired: number[] = [];
    const cancelA = scheduler.schedule(10, () => fired.push(1));
    const cancelB = scheduler.schedule(10, () => fired.push(2));
    expect(scheduler.pending()).toBe(2);

    cancelA();
    cancelA();
    expect(scheduler.pending()).toBe(1);

    scheduler.runDue(10);
    expect(fired).toStrictEqual([2]);
    cancelB();
    expect(scheduler.pending()).toBe(0);
  });

  it('bases due times on the injected clock when one is given', () => {
    const clock = createManualClock(1000);
    const scheduler = createManualScheduler(clock.now);
    const fired: number[] = [];
    scheduler.schedule(30, () => fired.push(clock.now()));

    clock.set(1029);
    scheduler.runDue(1029);
    expect(fired).toStrictEqual([]);
    clock.set(1030);
    scheduler.runDue(1030);
    expect(fired).toStrictEqual([1030]);
  });

  it('bases due times on the latest runDue time without a clock', () => {
    const scheduler = createManualScheduler();
    const fired: number[] = [];
    scheduler.runDue(500);
    scheduler.schedule(30, () => fired.push(1));
    scheduler.runDue(529);
    expect(fired).toStrictEqual([]);
    scheduler.runDue(530);
    expect(fired).toStrictEqual([1]);
  });

  it('treats negative and non-finite delays as 0', () => {
    const scheduler = createManualScheduler();
    const fired: number[] = [];
    scheduler.schedule(-5, () => fired.push(1));
    scheduler.schedule(Number.NaN, () => fired.push(2));
    scheduler.runDue(0);
    expect(fired).toStrictEqual([1, 2]);
  });

  it('fires timers scheduled during runDue when they are already due', () => {
    const scheduler = createManualScheduler();
    const fired: string[] = [];
    scheduler.schedule(10, () => {
      fired.push('first');
      scheduler.schedule(0, () => fired.push('nested'));
      scheduler.schedule(100, () => fired.push('later'));
    });
    scheduler.runDue(20);
    expect(fired).toStrictEqual(['first', 'nested']);
    expect(scheduler.pending()).toBe(1);
  });

  it('a callback can cancel a later timer before it fires', () => {
    const scheduler = createManualScheduler();
    const fired: string[] = [];
    let cancelSecond = (): void => undefined;
    scheduler.schedule(10, () => {
      fired.push('first');
      cancelSecond();
    });
    cancelSecond = scheduler.schedule(10, () => fired.push('second'));
    scheduler.runDue(10);
    expect(fired).toStrictEqual(['first']);
  });

  it('throws when a timer keeps rescheduling itself at the same time', () => {
    const scheduler = createManualScheduler();
    const loop = (): void => {
      scheduler.schedule(0, loop);
    };
    scheduler.schedule(0, loop);
    expect(() => scheduler.runDue(0)).toThrow(/rescheduling/);
  });
});
