import { describe, expect, it } from 'vitest';
import { NOT_HELD, pointerDown, pointerEnd } from './pointer';
import { CHILD_TARGET, OUTSIDE_TARGET, createPointerRig, plain, pointerEvent } from './test-support';

describe('pointerDown and pointerEnd', () => {
  it('start a press only for a primary pointer on the surface, main button for a mouse (Req 6.1, 6.2)', () => {
    expect(pointerDown(NOT_HELD, pointerEvent({ pointerType: 'touch' }), true).raw).toBe('down');
    expect(pointerDown(NOT_HELD, pointerEvent({ pointerType: 'pen', button: 2 }), true).raw).toBe('down');
    expect(pointerDown(NOT_HELD, pointerEvent({ pointerType: 'mouse', button: 0 }), true).raw).toBe('down');
    expect(pointerDown(NOT_HELD, pointerEvent({ pointerType: 'mouse', button: 2 }), true).raw).toBeNull();
    expect(pointerDown(NOT_HELD, pointerEvent({ isPrimary: false }), true).raw).toBeNull();
    expect(pointerDown(NOT_HELD, pointerEvent(), false).raw).toBeNull();
    const held = pointerDown(NOT_HELD, pointerEvent({ pointerId: 4 }), true).state;
    expect(pointerDown(held, pointerEvent({ pointerId: 5 }), true)).toStrictEqual({ state: held, raw: null });
  });

  it('end the press once, for the held pointer only (Req 6.3 to 6.5)', () => {
    const held = pointerDown(NOT_HELD, pointerEvent({ pointerId: 4 }), true).state;
    expect(pointerEnd(held, { pointerId: 9 })).toStrictEqual({ state: held, raw: null });
    const ended = pointerEnd(held, { pointerId: 4 });
    expect(ended).toStrictEqual({ state: NOT_HELD, raw: 'up' });
    expect(pointerEnd(ended.state, { pointerId: 4 }).raw).toBeNull();
  });
});

describe('Pointer_Source', () => {
  it('a tap and a hold give a dot-length and a dash-length press with capture (Req 6.1, 6.3)', () => {
    const rig = createPointerRig();
    rig.pointer.start();
    expect(rig.statuses).toStrictEqual(['active']);
    rig.surface.dispatch('pointerdown', { pointerId: 7, target: CHILD_TARGET });
    expect(rig.surface.captured.has(7)).toBe(true);
    rig.clock.set(1100);
    rig.scheduler.runDue(1100);
    rig.surface.dispatch('pointerup', { pointerId: 7, target: OUTSIDE_TARGET });
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'pointer' },
      { kind: 'up', t: 1100, source: 'pointer' },
    ]);
  });

  it('prevents the context menu on the surface (Req 6.6)', () => {
    const rig = createPointerRig();
    rig.pointer.start();
    expect(rig.surface.dispatch('contextmenu').prevented).toBe(true);
  });

  it('applies the no-gesture styles while active and restores them on stop (Req 6.7)', () => {
    const rig = createPointerRig();
    expect(rig.surface.styleApplied()).toBe(false);
    rig.pointer.start();
    expect(rig.surface.styleApplied()).toBe(true);
    rig.pointer.stop();
    expect(rig.surface.styleApplied()).toBe(false);
  });

  it('listens only on the surface, and on the document only after a failed capture (Req 6.8, 6.11)', () => {
    const rig = createPointerRig({ min: 0 });
    rig.pointer.start();
    expect(rig.surface.listenerCount()).toBe(5);
    expect(rig.doc.listenerCount()).toBe(0);

    rig.surface.captureFails = true;
    rig.surface.dispatch('pointerdown', { pointerId: 2 });
    expect(rig.doc.listenerCount()).toBe(2);
    rig.clock.set(1400);
    rig.doc.dispatch('pointerup', { pointerId: 3 });
    expect(rig.presses).toHaveLength(1);
    rig.doc.dispatch('pointercancel', { pointerId: 2 });
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'pointer' },
      { kind: 'up', t: 1400, source: 'pointer' },
    ]);
    expect(rig.doc.listenerCount()).toBe(0);
  });

  it('ignores right clicks, secondary pointers and a second finger', () => {
    const rig = createPointerRig({ min: 0 });
    rig.pointer.start();
    rig.surface.dispatch('pointerdown', { pointerType: 'mouse', button: 2 });
    rig.surface.dispatch('pointerdown', { pointerId: 5, isPrimary: false });
    expect(rig.presses).toStrictEqual([]);
    rig.surface.dispatch('pointerdown', { pointerId: 1 });
    rig.surface.dispatch('pointerdown', { pointerId: 2 });
    rig.surface.dispatch('pointerup', { pointerId: 2 });
    expect(plain(rig.presses)).toStrictEqual([{ kind: 'down', t: 1000, source: 'pointer' }]);
  });

  it('lostpointercapture then pointerup gives one Raw_Up (Req 6.4)', () => {
    const rig = createPointerRig({ min: 0 });
    rig.pointer.start();
    rig.surface.dispatch('pointerdown', { pointerId: 1 });
    rig.clock.set(1050);
    rig.surface.dispatch('lostpointercapture', { pointerId: 1 });
    rig.clock.set(1090);
    rig.surface.dispatch('pointerup', { pointerId: 1 });
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'pointer' },
      { kind: 'up', t: 1050, source: 'pointer' },
    ]);
  });

  it('stop while held releases capture, emits one up at the clock and removes every listener (Req 6.10)', () => {
    const rig = createPointerRig({ min: 0 });
    rig.pointer.start();
    rig.surface.dispatch('pointerdown', { pointerId: 3 });
    rig.clock.set(1700);
    rig.pointer.stop();
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'pointer' },
      { kind: 'up', t: 1700, source: 'pointer' },
    ]);
    expect(rig.statuses).toStrictEqual(['active', 'off']);
    expect(rig.surface.captured.size).toBe(0);
    expect(rig.surface.listenerCount()).toBe(0);
    expect(rig.page.listenerCount()).toBe(0);
    rig.surface.dispatch('lostpointercapture', { pointerId: 3 });
    expect(rig.presses).toHaveLength(2);
  });

  it('blur while held ends the press; the later pointerup emits nothing (Req 7.1, 7.4)', () => {
    const rig = createPointerRig({ min: 0 });
    rig.pointer.start();
    rig.surface.dispatch('pointerdown');
    rig.clock.set(1200);
    rig.page.blur();
    rig.surface.dispatch('pointerup');
    expect(plain(rig.presses)).toStrictEqual([
      { kind: 'down', t: 1000, source: 'pointer' },
      { kind: 'up', t: 1200, source: 'pointer' },
    ]);
    expect(rig.pointer.status()).toBe('active');
  });

  it('a tap shorter than 30 ms emits nothing (Req 3.4)', () => {
    const rig = createPointerRig();
    rig.pointer.start();
    rig.surface.dispatch('pointerdown');
    rig.clock.set(1020);
    rig.surface.dispatch('pointerup');
    rig.scheduler.runDue(5000);
    expect(rig.presses).toStrictEqual([]);
  });

  it('starts with no surface and keys nothing', () => {
    const rig = createPointerRig({ noSurface: true });
    rig.pointer.start();
    expect(rig.pointer.status()).toBe('active');
    rig.surface.dispatch('pointerdown');
    expect(rig.presses).toStrictEqual([]);
  });

  it('passes nothing while off (Req 6.9)', () => {
    const rig = createPointerRig({ min: 0 });
    rig.surface.dispatch('pointerdown');
    expect(rig.presses).toStrictEqual([]);
    expect(rig.surface.listenerCount()).toBe(0);
  });
});
