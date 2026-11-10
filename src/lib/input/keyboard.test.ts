import { describe, expect, it } from 'vitest';
import { createManualClock, createManualScheduler } from './clock';
import { createKeyRouter } from './key-router';
import { createKeyboardSource } from './keyboard';
import { createFakeKeyTarget, createFakePage, createKeyRig, plain } from './test-support';
import type { PressEvent } from './types';

describe('Keyboard_Source', () => {
  it('reports active on start and off on stop, once each, and redundant calls do nothing (Req 1.3, 1.6)', () => {
    const rig = createKeyRig();
    rig.keyboard.start();
    expect(rig.keyboard.status()).toBe('active');
    rig.keyboard.start();
    expect(rig.target.listenerCount()).toBe(1);
    rig.keyboard.stop();
    rig.keyboard.stop();
    expect(rig.statuses).toStrictEqual([
      { source: 'keyboard', status: 'active' },
      { source: 'keyboard', status: 'off' },
    ]);
    expect(rig.target.listenerCount()).toBe(0);
    expect(rig.page.listenerCount()).toBe(0);
  });

  it('confirms a press through the scheduler at Raw_Down + 30 ms (Req 3.3)', () => {
    const rig = createKeyRig();
    rig.keyboard.start();
    const down = rig.target.down('Space');
    expect(down.prevented).toBe(true);
    expect(rig.keyboard.pendingSince()).toBe(1000);
    expect(rig.scheduler.pending()).toBe(1);

    rig.clock.set(1029);
    rig.scheduler.runDue(1029);
    expect(rig.presses).toStrictEqual([]);
    rig.clock.set(1030);
    rig.scheduler.runDue(1030);
    expect(plain(rig.presses)).toStrictEqual([{ kind: 'down', t: 1000, source: 'keyboard' }]);

    rig.clock.set(1200);
    const up = rig.target.up('Space');
    expect(up.prevented).toBe(true);
    expect(plain(rig.presses).at(-1)).toStrictEqual({ kind: 'up', t: 1200, source: 'keyboard' });
  });

  it('reschedules a confirmation timer that fires early', () => {
    const clock = createManualClock(1000);
    // No clock: due times count from the last runDue (0), so the first timer fires early.
    const scheduler = createManualScheduler();
    const target = createFakeKeyTarget();
    const keyboard = createKeyboardSource({
      router: createKeyRouter(target),
      clock: clock.now,
      scheduler,
      page: createFakePage(),
      focus: () => 'keying',
    });
    const presses: PressEvent[] = [];
    keyboard.onPress((event) => presses.push(event));
    keyboard.start();
    target.down('Enter');
    clock.set(1010);
    scheduler.runDue(1010);
    expect(presses).toStrictEqual([]);
    expect(scheduler.pending()).toBe(1);
    clock.set(1030);
    scheduler.runDue(1030);
    expect(plain(presses)).toStrictEqual([{ kind: 'down', t: 1000, source: 'keyboard' }]);
  });

  it('calls preventDefault per the focus rule', () => {
    const rig = createKeyRig();
    rig.keyboard.start();
    rig.focus = 'interactive';
    const onButton = rig.target.down('Space');
    expect(onButton.prevented).toBe(false);
    expect(rig.target.up('Space').prevented).toBe(false);
    rig.focus = 'editable';
    expect(rig.target.down('Enter').prevented).toBe(false);
    expect(rig.target.up('Enter').prevented).toBe(false);
    rig.focus = 'keying';
    expect(rig.target.down('KeyA').prevented).toBe(false);
    expect(rig.target.down('NumpadEnter').prevented).toBe(true);
    expect(rig.target.down('NumpadEnter', true).prevented).toBe(true);
    expect(rig.target.up('NumpadEnter').prevented).toBe(true);
    expect(rig.presses).toStrictEqual([]);
  });

  it('a short tap under the minimum emits nothing (Req 3.4)', () => {
    const rig = createKeyRig();
    rig.keyboard.start();
    rig.target.down('Space');
    rig.clock.set(1020);
    rig.target.up('Space');
    rig.scheduler.runDue(2000);
    expect(rig.presses).toStrictEqual([]);
    expect(rig.scheduler.pending()).toBe(0);
  });

  it('blur while held emits one up at the clock; the later keyup and hide emit nothing (Req 7.1, 7.4, 7.7)', () => {
    const rig = createKeyRig({ min: 0 });
    rig.keyboard.start();
    rig.target.down('Space');
    rig.clock.set(1500);
    rig.page.blur();
    rig.page.hide();
    rig.clock.set(1600);
    rig.target.up('Space');
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'keyboard' },
      { kind: 'up', t: 1500, source: 'keyboard' },
    ]);
    expect(rig.keyboard.status()).toBe('active');
    rig.target.down('Space');
    expect(rig.presses).toHaveLength(3);
  });

  it('stop while pending emits nothing and clears the timer (Req 1.4)', () => {
    const rig = createKeyRig();
    rig.keyboard.start();
    rig.target.down('Space');
    rig.keyboard.stop();
    rig.clock.set(2000);
    rig.scheduler.runDue(2000);
    expect(rig.presses).toStrictEqual([]);
    expect(rig.scheduler.pending()).toBe(0);
    expect(rig.keyboard.pendingSince()).toBeNull();
  });

  it('stop while held emits one up at the clock before off (Req 1.5)', () => {
    const rig = createKeyRig({ min: 0 });
    const order: string[] = [];
    rig.keyboard.onPress((event) => order.push(`${event.kind}@${event.t}`));
    rig.keyboard.onStatus((status) => order.push(status));
    rig.keyboard.start();
    rig.target.down('Enter');
    rig.clock.set(1800);
    rig.keyboard.stop();
    expect(order).toStrictEqual(['active', 'down@1000', 'up@1800', 'off']);
  });

  it('applies a new Min_Press_Duration from the next press and rejects bad values', () => {
    const rig = createKeyRig();
    expect(rig.keyboard.setMinPressDuration(0)).toStrictEqual({ ok: true, value: 0 });
    expect(rig.keyboard.setMinPressDuration(600).ok).toBe(false);
    rig.keyboard.start();
    rig.target.down('Space');
    expect(plain(rig.presses)).toStrictEqual([{ kind: 'down', t: 1000, source: 'keyboard' }]);
  });
});
