import { describe, expect, it } from 'vitest';
import { createFakeClient } from '@/lib/conversation/test-support';
import { pressEvent, type PressEvent } from '@/lib/input';
import { cheatSheetStep, CLOSED_SHEET, initialFirstRun, isOpenStep } from '@/lib/onboarding';
import { createAlarmHandler, type CardView } from './alarm-handler';
import type { ChimePlayer } from './chime-player';
import { createFakeCardView, createFakeChimePlayer } from './fakes';

const down = (t = 0): PressEvent => pressEvent('down', t, 'switch');
const up = (t = 0): PressEvent => pressEvent('up', t, 'switch');

/** A card view and chime that write to one shared log, so the order of effects is visible. */
function loggingRig() {
  const log: string[] = [];
  const view: CardView = { show: () => log.push('show'), hide: () => log.push('hide') };
  const fake = createFakeChimePlayer();
  const chime: ChimePlayer = {
    ...fake,
    start: () => log.push('chime-start'),
    stop: () => log.push('chime-stop'),
  };
  const handler = createAlarmHandler({ chime });
  handler.setView(view);
  handler.onActiveChange((active) => log.push(`active:${active}`));
  handler.setFocusKeyingSurface(() => log.push('focus'));
  return { log, handler, fake };
}

describe('createAlarmHandler', () => {
  it('shows the card, starts the chime and notifies once, in that order, inside start() (Requirement 1.1)', () => {
    const { log, handler } = loggingRig();
    handler.start();
    expect(log).toEqual(['show', 'chime-start', 'active:true']);
    expect(handler.state()).toBe('ringing');
    expect(handler.isActive()).toBe(true);
  });

  it('ignores a repeated start() while active (Requirements 1.2, 7.7)', () => {
    const { log, handler } = loggingRig();
    handler.start();
    handler.start();
    handler.handlePress(down(10));
    handler.start();
    expect(log).toEqual(['show', 'chime-start', 'active:true', 'hide', 'chime-stop']);
    expect(handler.state()).toBe('closing');
  });

  it('dismisses on a down, waits for its up, then focuses the Keying_Surface once (2.1, 2.2, 2.8, 2.10)', () => {
    const { log, handler } = loggingRig();
    handler.start();
    handler.handlePress(up(5)); // 2.3: consumed, still ringing
    expect(handler.state()).toBe('ringing');
    handler.handlePress(down(10));
    expect(handler.state()).toBe('closing');
    expect(handler.isActive()).toBe(true);
    handler.handlePress(down(12)); // 2.12
    handler.handlePress(up(20));
    expect(handler.state()).toBe('idle');
    expect(handler.isActive()).toBe(false);
    expect(log).toEqual(['show', 'chime-start', 'active:true', 'hide', 'chime-stop', 'active:false', 'focus']);
  });

  it('goes straight to idle on a partner dismissal, and a second Dismissal does nothing (2.4, 2.5, 2.13)', () => {
    const { log, handler } = loggingRig();
    handler.start();
    handler.partnerDismiss();
    handler.partnerDismiss();
    handler.cardPointer('down');
    expect(handler.state()).toBe('idle');
    expect(log).toEqual(['show', 'chime-start', 'active:true', 'hide', 'chime-stop', 'active:false', 'focus']);
  });

  it('treats the card pointer path like a press: down dismisses, up ends the episode (Requirement 2.6)', () => {
    const { log, handler } = loggingRig();
    handler.start();
    handler.cardPointer('down');
    expect(handler.state()).toBe('closing');
    handler.cardPointer('up');
    expect(handler.state()).toBe('idle');
    expect(log.filter((entry) => entry === 'focus')).toHaveLength(1);
  });

  it('does nothing for presses and dismissals while idle', () => {
    const { log, handler } = loggingRig();
    handler.handlePress(down());
    handler.handlePress(up());
    handler.partnerDismiss();
    handler.cardPointer('up');
    expect(log).toEqual([]);
    expect(handler.isActive()).toBe(false);
  });

  it.each([
    ['a throwing view', { throwOnShow: true, view: true, throwChime: false }],
    ['a throwing chime', { throwOnShow: false, view: true, throwChime: true }],
    ['no view', { throwOnShow: false, view: false, throwChime: false }],
    ['a throwing view and chime', { throwOnShow: true, view: true, throwChime: true }],
  ] as const)('rings with %s and still accepts all 3 Dismissals (Requirements 1.11, 7.3 to 7.5)', (_name, opts) => {
    const dismissals = [
      (h: ReturnType<typeof createAlarmHandler>) => {
        h.handlePress(down(1));
        h.handlePress(up(2));
      },
      (h: ReturnType<typeof createAlarmHandler>) => h.partnerDismiss(),
      (h: ReturnType<typeof createAlarmHandler>) => {
        h.cardPointer('down');
        h.cardPointer('up');
      },
    ];
    for (const dismiss of dismissals) {
      const chime = createFakeChimePlayer({ throwOnStart: opts.throwChime });
      const view = createFakeCardView({ throwOnShow: opts.throwOnShow });
      const handler = createAlarmHandler({ chime });
      if (opts.view) handler.setView(view);
      const changes: boolean[] = [];
      handler.onActiveChange((active) => changes.push(active));
      expect(() => handler.start()).not.toThrow();
      expect(handler.state()).toBe('ringing');
      expect(handler.isActive()).toBe(true);
      expect(chime.calls).toEqual(['start']); // the chime starts even when the card fails
      expect(changes).toEqual([true]);
      dismiss(handler);
      expect(handler.state()).toBe('idle');
      expect(chime.calls).toEqual(['start', 'stop']);
      expect(changes).toEqual([true, false]);
      if (opts.view) expect(view.calls).toEqual(['show', 'hide']);
    }
  });

  it('keeps notifying the other listeners and focuses when one listener throws (Requirement 2.8)', () => {
    const { log, handler } = loggingRig();
    handler.onActiveChange(() => {
      throw new Error('listener failed');
    });
    handler.onActiveChange((active) => log.push(`second:${active}`));
    handler.start();
    handler.partnerDismiss();
    expect(log).toEqual([
      'show',
      'chime-start',
      'active:true',
      'second:true',
      'hide',
      'chime-stop',
      'active:false',
      'second:false',
      'focus',
    ]);
  });

  it('survives a throwing focus function and stops notifying after unsubscribe', () => {
    const handler = createAlarmHandler({ chime: createFakeChimePlayer() });
    handler.setFocusKeyingSurface(() => {
      throw new Error('no element');
    });
    const seen: boolean[] = [];
    const off = handler.onActiveChange((active) => seen.push(active));
    handler.start();
    expect(() => handler.partnerDismiss()).not.toThrow();
    off();
    handler.start();
    expect(seen).toEqual([true, false]);
  });

  it('starts while a Client request is pending and Settings, the Cheat_Sheet and onboarding are open (7.2)', () => {
    const client = createFakeClient();
    client.create(() => undefined).update('iwtgo', []); // a request that never answers
    const settingsOpen = true;
    const sheet = cheatSheetStep(CLOSED_SHEET, { type: 'unknown', pattern: '..-.-' }, { onboardingOpen: false, alarmActive: false });
    const flow = initialFirstRun();
    expect([settingsOpen, sheet.open, isOpenStep(flow.step), client.updates.length > 0]).toEqual([true, true, true, true]);
    const { log, handler } = loggingRig();
    handler.start();
    expect(handler.isActive()).toBe(true);
    expect(log).toEqual(['show', 'chime-start', 'active:true']);
  });

  it('delegates the sound note to the chime and notifies subscribers on changes', () => {
    const { handler, fake } = loggingRig();
    let notified = 0;
    const off = handler.subscribe(() => {
      notified += 1;
    });
    expect(handler.soundUnavailable()).toBe(false);
    handler.start(); // state change
    expect(notified).toBe(1);
    fake.setSoundUnavailable(true);
    expect(notified).toBe(2);
    off();
    handler.partnerDismiss();
    expect(notified).toBe(2);
  });

  it('notifies subscribers once per state change', () => {
    const handler = createAlarmHandler({ chime: createFakeChimePlayer() });
    let notified = 0;
    handler.subscribe(() => {
      notified += 1;
    });
    handler.start();
    handler.handlePress(up(1)); // no change
    handler.handlePress(down(2));
    handler.handlePress(up(3));
    expect(notified).toBe(3);
  });
});
