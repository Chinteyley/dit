import { describe, expect, it } from 'vitest';
import { createCheatSheetStore, createUnknownPatternHandler } from './cheat-sheet-store';
import type { CheatSheetContext } from './cheat-sheet-state';

function rig() {
  const ctx: { -readonly [K in keyof CheatSheetContext]: CheatSheetContext[K] } = {
    onboardingOpen: false,
    alarmActive: false,
  };
  const store = createCheatSheetStore(() => ctx);
  const handler = createUnknownPatternHandler(store);
  let notified = 0;
  store.subscribe(() => {
    notified += 1;
  });
  return { ctx, store, handler, notified: () => notified };
}

describe('createUnknownPatternHandler', () => {
  it('opens the sheet with reason unknown and the pattern (Requirement 10.1)', () => {
    const r = rig();
    r.handler.handle('..-.-');
    expect(r.store.getState()).toEqual({ open: true, reason: 'unknown', pattern: '..-.-' });
    expect(r.notified()).toBe(1);
  });

  it('does nothing while onboarding is open or the alarm is active (Requirements 10.11, 7.8)', () => {
    const r = rig();
    r.ctx.onboardingOpen = true;
    r.handler.handle('..-.-');
    r.ctx.onboardingOpen = false;
    r.ctx.alarmActive = true;
    r.handler.handle('.-.-.-.');
    expect(r.store.getState().open).toBe(false);
    expect(r.notified()).toBe(0);
    r.ctx.alarmActive = false;
    r.handler.handle('---.-');
    expect(r.store.getState()).toEqual({ open: true, reason: 'unknown', pattern: '---.-' });
  });

  it('notifies once per change and not for an action that changes nothing', () => {
    const r = rig();
    r.handler.handle('..-.-');
    r.handler.handle('..-.-'); // same pattern
    r.store.dispatch({ type: 'partner-open' });
    r.store.dispatch({ type: 'partner-open' });
    r.store.dispatch({ type: 'char-committed' }); // partner sheets stay open
    r.store.dispatch({ type: 'close' });
    r.store.dispatch({ type: 'close' });
    expect(r.notified()).toBe(3);
    expect(r.store.getState()).toEqual({ open: false, reason: null, pattern: null });
  });

  it('closes an unknown sheet on the next committed character (Requirement 10.3)', () => {
    const r = rig();
    r.handler.handle('..-.-');
    r.store.dispatch({ type: 'char-committed' });
    expect(r.store.getState().open).toBe(false);
  });

  it('keeps notifying other subscribers when one throws, and stops after unsubscribe', () => {
    const r = rig();
    const off = r.store.subscribe(() => {
      throw new Error('subscriber failed');
    });
    r.handler.handle('..-.-');
    expect(r.notified()).toBe(1);
    off();
    r.store.dispatch({ type: 'close' });
    expect(r.notified()).toBe(2);
  });
});
