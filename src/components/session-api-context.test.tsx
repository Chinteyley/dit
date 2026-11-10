// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_ENABLED_SOURCES } from '@/lib/conversation';
import { INITIAL_SNAPSHOT } from '@/hooks/useMorseSession';
import { SessionApiContext, type SessionApiContextValue } from './session-api-context';

afterEach(cleanup);

/** Renders a consumer with no provider and returns what it read. */
function readWithoutProvider(): SessionApiContextValue {
  const seen: SessionApiContextValue[] = [];
  function Consumer() {
    seen.push(useContext(SessionApiContext));
    return null;
  }
  render(<Consumer />);
  const value = seen.at(-1);
  if (value === undefined) throw new Error('the consumer did not render');
  return value;
}

describe('SessionApiContext without a provider', () => {
  it('reports the default sources with blink off, all statuses off, and ignores every setter (O11.12)', () => {
    const { sources } = readWithoutProvider();
    expect(sources.enabled()).toStrictEqual(DEFAULT_ENABLED_SOURCES);
    expect(sources.enabled().blink).toBe(false);
    expect(sources.statuses()).toStrictEqual({ keyboard: 'off', switch: 'off', pointer: 'off', blink: 'off' });
    expect(() => {
      sources.setEnabled('keyboard', false);
      sources.startBlink();
      sources.stopBlink();
      sources.restore({ keyboard: false, switch: false, pointer: false, blink: true });
      const unsubscribe = sources.onChange(() => undefined);
      unsubscribe();
    }).not.toThrow();
    expect(sources.enabled()).toStrictEqual(DEFAULT_ENABLED_SOURCES);
  });

  it('has no pending press and a learner that is never available (design Integration point 5)', async () => {
    const { learner, pendingSince } = readWithoutProvider();
    expect(pendingSince()).toBeNull();
    expect(learner.isArmed()).toBe(false);
    await expect(learner.arm()).resolves.toStrictEqual({
      ok: false,
      error: { reason: 'cancelled', message: 'not available' },
    });
    expect(learner.isArmed()).toBe(false);
    expect(learner.clear()).toStrictEqual({ ok: false, error: { reason: 'save-failed', message: 'not available' } });
    expect(() => learner.cancel()).not.toThrow();
  });

  it('has an inert controller and focus helper', () => {
    const { controller, focusKeyingSurface, setInitialEstimates } = readWithoutProvider();
    expect(controller.getSnapshot()).toBe(INITIAL_SNAPSHOT);
    expect(controller.updateSettings({ speechRate: 1.5 }).ok).toBe(false);
    expect(() => {
      controller.handlePress({ kind: 'down', t: 0, source: 'keyboard' });
      controller.discardInput();
      controller.onCharCommitted(() => undefined)();
      controller.subscribe(() => undefined)();
      focusKeyingSurface();
      setInitialEstimates(null);
    }).not.toThrow();
  });
});
