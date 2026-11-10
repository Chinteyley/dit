import { describe, expect, it } from 'vitest';
import { pressEvent, type PressEvent } from '@/lib/input';
import { createCheatSheetStore, createUnknownPatternHandler } from '@/lib/onboarding';
import { INITIAL_ROUTER, consumerFor, createPressRouter, routePress } from './press-router';

function rig() {
  const flags = { alarm: false, onboarding: false };
  const calls: string[] = [];
  const record = (who: string) => (e: PressEvent) => {
    calls.push(`${who}:${e.kind}@${e.t}`);
  };
  const router = createPressRouter({
    alarm: { isActive: () => flags.alarm, handlePress: record('alarm') },
    onboarding: { isOpen: () => flags.onboarding, handlePress: record('onboarding') },
  });
  let discardThrows = false;
  const session = {
    handlePress: record('session'),
    discardInput: () => {
      calls.push('discard');
      if (discardThrows) throw new Error('discard failed');
    },
  };
  return {
    flags,
    calls,
    router,
    session,
    failDiscard: () => {
      discardThrows = true;
    },
  };
}

const down = (t: number): PressEvent => pressEvent('down', t, 'keyboard');
const up = (t: number): PressEvent => pressEvent('up', t, 'keyboard');

describe('routePress', () => {
  it('picks the alarm, then onboarding, then the session', () => {
    expect(consumerFor({ alarmActive: true, onboardingOpen: true })).toBe('alarm');
    expect(consumerFor({ alarmActive: false, onboardingOpen: true })).toBe('onboarding');
    expect(consumerFor({ alarmActive: false, onboardingOpen: false })).toBe('session');
  });

  it('remembers the owner of a down and drops an up that would go elsewhere (Requirement 12.8)', () => {
    const idle = { alarmActive: false, onboardingOpen: false };
    const open = { alarmActive: false, onboardingOpen: true };
    const first = routePress(INITIAL_ROUTER, down(0), idle);
    expect(first).toEqual({ state: { downOwner: 'session' }, to: 'session' });
    expect(routePress(first.state, up(10), open)).toEqual({ state: INITIAL_ROUTER, to: null });
    expect(routePress(first.state, up(10), idle)).toEqual({ state: INITIAL_ROUTER, to: 'session' });
    expect(routePress(INITIAL_ROUTER, up(10), open)).toEqual({ state: INITIAL_ROUTER, to: 'onboarding' });
  });
});

describe('createPressRouter', () => {
  it('drops events that arrive before connect() and after disconnect', () => {
    const r = rig();
    r.router.route(down(0));
    r.router.route(up(10));
    expect(r.calls).toEqual([]);
    const disconnect = r.router.connect(r.session);
    r.router.route(down(20));
    disconnect();
    r.router.route(up(30));
    expect(r.calls).toEqual(['session:down@20']);
  });

  it('keeps a newer connection when an older disconnect runs late', () => {
    const r = rig();
    const disconnectOld = r.router.connect(r.session);
    const newer = { handlePress: (e: PressEvent) => r.calls.push(`newer:${e.kind}`), discardInput: () => undefined };
    r.router.connect(newer);
    disconnectOld();
    r.router.route(down(0));
    expect(r.calls).toEqual(['newer:down']);
  });

  it('sends a session press there while the alarm is idle and onboarding is closed', () => {
    const r = rig();
    r.router.connect(r.session);
    r.router.route(down(0));
    r.router.route(up(80));
    expect(r.calls).toEqual(['session:down@0', 'session:up@80']);
  });

  it('keeps sending presses to the session while the Cheat_Sheet is open (Requirement 10.8)', () => {
    const r = rig();
    const sheet = createCheatSheetStore(() => ({ onboardingOpen: r.flags.onboarding, alarmActive: r.flags.alarm }));
    createUnknownPatternHandler(sheet).handle('..-.-');
    expect(sheet.getState().open).toBe(true);
    r.router.connect(r.session);
    r.router.route(down(0));
    r.router.route(up(80));
    sheet.dispatch({ type: 'partner-open' });
    r.router.route(down(200));
    r.router.route(up(260));
    expect(r.calls).toEqual(['session:down@0', 'session:up@80', 'session:down@200', 'session:up@260']);
    expect(sheet.getState()).toEqual({ open: true, reason: 'partner', pattern: '..-.-' });
  });

  it('reads the flags when each event arrives', () => {
    const r = rig();
    r.router.connect(r.session);
    r.flags.alarm = true;
    r.flags.onboarding = true;
    r.router.route(down(0));
    r.router.route(up(10));
    r.flags.alarm = false;
    r.router.route(down(20));
    r.router.route(up(30));
    r.flags.onboarding = false;
    r.router.route(down(40));
    r.router.route(up(50));
    expect(r.calls).toEqual([
      'alarm:down@0',
      'alarm:up@10',
      'onboarding:down@20',
      'onboarding:up@30',
      'session:down@40',
      'session:up@50',
    ]);
  });

  it('drops the up of a press that started before the flow opened (Requirement 12.8)', () => {
    const r = rig();
    r.router.connect(r.session);
    r.router.route(down(0));
    r.flags.onboarding = true;
    r.router.route(up(100));
    r.router.route(down(200));
    r.router.route(up(300));
    expect(r.calls).toEqual(['session:down@0', 'onboarding:down@200', 'onboarding:up@300']);
  });

  it('calls discardInput once per open change, and never throws (Requirement 12.10)', () => {
    const r = rig();
    r.router.onOnboardingOpenChange();
    expect(r.calls).toEqual([]);
    r.router.connect(r.session);
    r.router.onOnboardingOpenChange();
    r.router.onOnboardingOpenChange();
    expect(r.calls).toEqual(['discard', 'discard']);
    r.failDiscard();
    expect(() => r.router.onOnboardingOpenChange()).not.toThrow();
    expect(r.calls).toEqual(['discard', 'discard', 'discard']);
  });
});
