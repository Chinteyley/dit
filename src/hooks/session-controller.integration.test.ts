/**
 * Example tests for the onboarding-and-safety integration seams on the SessionController
 * (tasks 9.11 to 9.13): discardInput(), the withholdUp reset on the next down, and
 * onCharCommitted. Criterion numbers prefixed "O" are from the onboarding-and-safety spec.
 */
import { describe, expect, it } from 'vitest';
import { TEXT_MAX } from '@/lib/conversation';
import { BACKSPACE, NEXT, SOS, SPACE, char, createControllerRig, symbol } from './session-controller.test-support';

describe('discardInput (O12.10, O12.2)', () => {
  it('drops the buffered pattern and the held down without decoding, announcing or calling the Client', () => {
    const rig = createControllerRig();
    rig.down();
    rig.script(char('h'));
    rig.up();
    const updates = rig.client.updates.length;
    const announcement = rig.controller.getSnapshot().announcement;
    const uiTimers = rig.ui.pending();

    rig.engine().deadline = rig.clock.now() + 300;
    rig.script(symbol('.'));
    rig.down();
    expect(rig.controller.getSnapshot().session.currentPattern).toBe('.');
    expect(rig.scheduler.pending()).toBe(1);
    const engine = rig.engine();
    const resets = engine.resets;

    rig.controller.discardInput();
    expect(engine.resets).toBe(resets + 1);
    expect(rig.scheduler.pending()).toBe(0);
    expect(rig.engine()).toBe(engine);
    const { session } = rig.controller.getSnapshot();
    expect(session.currentPattern).toBe('');
    expect(session.currentText).toBe('h');
    expect(rig.client.updates).toHaveLength(updates);
    expect(rig.controller.getSnapshot().announcement).toBe(announcement);
    expect(rig.ui.pending()).toBe(uiTimers);

    const calls = engine.calls.length;
    rig.up();
    expect(engine.calls).toHaveLength(calls);
    expect(rig.alarm.presses).toEqual([]);
    rig.down();
    expect(engine.calls.at(-1)).toEqual({ kind: 'press', t: rig.clock.now() });
  });

  it('keeps the same Engine, so the estimates are unchanged', () => {
    const rig = createControllerRig();
    const before = rig.engine().estimates();
    rig.controller.discardInput();
    expect(rig.engines.engines).toHaveLength(1);
    expect(rig.engine().estimates()).toEqual(before);
  });

  it('does nothing after dispose()', () => {
    const rig = createControllerRig();
    rig.controller.dispose();
    rig.controller.discardInput();
    expect(rig.engine().calls).toEqual([]);
  });
});

describe('the withheld up is cleared by the next down (O12.8)', () => {
  it('after discardInput, a down without the dropped up reaches press, and its up reaches release once', () => {
    const rig = createControllerRig();
    rig.down();
    rig.controller.discardInput();
    // A Press_Router drops the matching up; the next press arrives as a down.
    rig.clock.advance(400);
    rig.down();
    rig.clock.advance(80);
    rig.up();
    const engine = rig.engine();
    expect(engine.calls.filter((call) => call.kind !== 'reset')).toEqual([
      { kind: 'press', t: 1_000 },
      { kind: 'press', t: 1_400 },
      { kind: 'release', t: 1_480 },
    ]);
  });

  it('after an Engine replacement, a down without the dropped up reaches the new Engine normally', () => {
    const rig = createControllerRig();
    rig.down();
    rig.controller.setInitialEstimates(null);
    rig.clock.advance(300);
    rig.down();
    rig.clock.advance(100);
    rig.up();
    expect(rig.engine().calls).toEqual([
      { kind: 'press', t: 1_300 },
      { kind: 'release', t: 1_400 },
    ]);
  });

  it('without a dropped up, the withhold rule still drops exactly one up', () => {
    const rig = createControllerRig();
    rig.down();
    rig.controller.setInitialEstimates(null);
    rig.up();
    rig.down();
    rig.up();
    expect(rig.engine().calls).toEqual([
      { kind: 'press', t: 1_000 },
      { kind: 'release', t: 1_000 },
    ]);
  });
});

describe('onCharCommitted (O10.3, O10.4, O10.11)', () => {
  it('fires once per char, after its effects and before subscribers, with the text already committed', () => {
    const rig = createControllerRig();
    const order: string[] = [];
    const seenText: string[] = [];
    rig.controller.subscribe(() => order.push('notify'));
    rig.controller.onCharCommitted((c) => {
      order.push(`char:${c}`);
      seenText.push(rig.controller.getSnapshot().session.currentText);
    });
    rig.down();
    rig.script(char('a'));
    rig.up();
    expect(order).toEqual(['notify', 'char:a', 'notify']);
    expect(seenText).toEqual(['a']);
  });

  it('also fires when the 500-character cap kept the character out', () => {
    const rig = createControllerRig();
    rig.down();
    rig.script(...Array.from({ length: TEXT_MAX }, () => char('a')));
    rig.up();
    expect(rig.controller.getSnapshot().session.currentText).toHaveLength(TEXT_MAX);
    const chars: string[] = [];
    rig.controller.onCharCommitted((c) => chars.push(c));
    rig.down();
    rig.script(char('b'));
    rig.up();
    expect(chars).toEqual(['b']);
    expect(rig.controller.getSnapshot().session.currentText).toHaveLength(TEXT_MAX);
  });

  it('never fires for symbol, space, unknown or command events, or for presses sent to the alarm', () => {
    const rig = createControllerRig();
    const chars: string[] = [];
    rig.controller.onCharCommitted((c) => chars.push(c));
    rig.down();
    rig.script(symbol('.'), SPACE, { type: 'unknown', pattern: '........' }, NEXT, BACKSPACE);
    rig.up();
    rig.down();
    rig.script(SOS);
    rig.up();
    expect(rig.alarm.isActive()).toBe(true);
    rig.script(char('z'));
    rig.down();
    rig.up();
    expect(chars).toEqual([]);
    expect(rig.alarm.presses).toHaveLength(2);
  });

  it('a throwing listener stops neither a second listener nor later events', () => {
    const rig = createControllerRig();
    const chars: string[] = [];
    rig.controller.onCharCommitted(() => {
      throw new Error('cheat sheet failed');
    });
    rig.controller.onCharCommitted((c) => chars.push(c));
    rig.down();
    rig.script(char('a'), char('b'));
    rig.up();
    expect(chars).toEqual(['a', 'b']);
    expect(rig.controller.getSnapshot().session.currentText).toBe('ab');
  });

  it('stops after unsubscribe and after dispose()', () => {
    const rig = createControllerRig();
    const first: string[] = [];
    const second: string[] = [];
    const unsubscribe = rig.controller.onCharCommitted((c) => first.push(c));
    rig.controller.onCharCommitted((c) => second.push(c));
    rig.down();
    rig.script(char('a'));
    rig.up();
    unsubscribe();
    rig.down();
    rig.script(char('b'));
    rig.up();
    rig.controller.dispose();
    rig.down();
    rig.script(char('c'));
    rig.up();
    expect(first).toEqual(['a']);
    expect(second).toEqual(['a', 'b']);
  });
});
