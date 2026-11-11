// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_ENABLED_SOURCES, unavailableLearner, type EnabledSources } from '@/lib/conversation';
import type { SourceStatus } from '@/lib/input';
import type { UseInputSourcesOptions, UseInputSourcesResult } from '@/hooks/useInputSources';
import { pressCalls, renderDitApp } from './dit-app.test-support';
import { SessionApiContext, type SessionApiContextValue } from './session-api-context';

/** When set, replaces useInputSources; otherwise the real hook runs. */
const hook = vi.hoisted(() => ({
  fake: null as null | ((opts: UseInputSourcesOptions) => UseInputSourcesResult),
}));
vi.mock('@/hooks/useInputSources', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useInputSources')>();
  return {
    ...actual,
    useInputSources: (opts: UseInputSourcesOptions) =>
      hook.fake === null ? actual.useInputSources(opts) : hook.fake(opts),
  };
});

const mediapipe = vi.hoisted(() => ({ imports: 0 }));
vi.mock('@mediapipe/tasks-vision', () => {
  mediapipe.imports += 1;
  return {};
});

let getUserMedia = vi.fn();

beforeEach(() => {
  hook.fake = null;
  getUserMedia = vi.fn(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
  vi.stubGlobal('navigator', { ...navigator, mediaDevices: { getUserMedia } });
});

afterEach(() => {
  cleanup();
  hook.fake = null;
  vi.unstubAllGlobals();
});

/** Reads SessionApiContext from inside DitApp (rendered in the overlay slot). */
function probe() {
  const seen: { current: SessionApiContextValue | null } = { current: null };
  function Probe() {
    const api = useContext(SessionApiContext);
    seen.current = api;
    return (
      <button type="button" onClick={() => api.sources.startBlink()}>
        Turn on camera
      </button>
    );
  }
  const api = (): SessionApiContextValue => {
    if (seen.current === null) throw new Error('the probe has not rendered');
    return seen.current;
  };
  return { element: <Probe />, api };
}

const blinkMessage = (api: SessionApiContextValue) =>
  api.controller.getSnapshot().messages.find((message) => message.id === 'source-blink');

describe('SessionApiContext.sources from DitApp (onboarding O11.9, O11.12 to O11.14)', () => {
  it('starts with the default sources, blink off, and asks for no camera on load', () => {
    const { element, api } = probe();
    renderDitApp({ overlay: element });
    expect(api().sources.enabled()).toStrictEqual(DEFAULT_ENABLED_SOURCES);
    expect(api().sources.statuses().blink).toBe('off');
    expect(api().sources.statuses().keyboard).toBe('active');
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(mediapipe.imports).toBe(0);
  });

  it('turns keyboard input off and on again, and reports each change', async () => {
    const { element, api } = probe();
    const rig = renderDitApp({ overlay: element });
    const onChange = vi.fn();
    const unsubscribe = api().sources.onChange(onChange);

    act(() => api().sources.setEnabled('keyboard', false));
    expect(api().sources.enabled().keyboard).toBe(false);
    expect(onChange).toHaveBeenCalled();
    expect(api().sources.statuses().keyboard).toBe('off');
    rig.surface().focus();
    await rig.user.keyboard(' ');
    expect(pressCalls(rig)).toStrictEqual([]);

    act(() => api().sources.restore(DEFAULT_ENABLED_SOURCES));
    expect(api().sources.enabled()).toStrictEqual(DEFAULT_ENABLED_SOURCES);
    await rig.user.keyboard(' ');
    expect(pressCalls(rig)).toStrictEqual(['press', 'release']);

    const calls = onChange.mock.calls.length;
    unsubscribe();
    act(() => api().sources.setEnabled('pointer', false));
    expect(onChange).toHaveBeenCalledTimes(calls);
  });

  it('starts blink from a click, and a retry after a failure passes through off (O11.13, O11.14)', async () => {
    const { element, api } = probe();
    const rig = renderDitApp({ overlay: element });
    const seen: { readonly status: SourceStatus; readonly message: boolean }[] = [];
    api().sources.onChange(() => {
      seen.push({ status: api().sources.statuses().blink, message: blinkMessage(api()) !== undefined });
    });

    await rig.user.click(screen.getByRole('button', { name: 'Turn on camera' }));
    expect(api().sources.enabled().blink).toBe(true);
    await waitFor(() => expect(api().sources.statuses().blink).toBe('permission-denied'));
    const status = screen.getByRole('list', { name: 'Status' });
    expect(within(status).getByText('Blink input: camera permission denied.')).toBeDefined();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    const failedAt = seen.length;
    await rig.user.click(screen.getByRole('button', { name: 'Turn on camera' }));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(api().sources.statuses().blink).toBe('permission-denied'));
    const retry = seen.slice(failedAt);
    const off = retry.findIndex((entry) => entry.status === 'off');
    expect(off).toBeGreaterThanOrEqual(0);
    expect(retry[off]?.message).toBe(false);
    expect(retry.slice(off + 1).some((entry) => entry.status === 'starting' || entry.status === 'permission-denied')).toBe(
      true,
    );
    expect(api().sources.enabled().blink).toBe(true);
  });

  it('stops blink', async () => {
    const { element, api } = probe();
    const rig = renderDitApp({ overlay: element });
    await rig.user.click(screen.getByRole('button', { name: 'Turn on camera' }));
    await waitFor(() => expect(api().sources.statuses().blink).toBe('permission-denied'));
    act(() => api().sources.stopBlink());
    expect(api().sources.enabled().blink).toBe(false);
    expect(api().sources.statuses().blink).toBe('off');
    expect(blinkMessage(api())).toBeUndefined();
  });
});

describe('SessionApiContext.learner and pendingSince from DitApp (design Integration point 5)', () => {
  const ACTIVE: Readonly<Record<keyof EnabledSources, SourceStatus>> = {
    keyboard: 'active',
    switch: 'active',
    pointer: 'active',
    blink: 'off',
  };

  it('passes the learner through and reads the latest pendingSince with a stable function', () => {
    const learner = unavailableLearner();
    let result: UseInputSourcesResult = {
      statuses: ACTIVE,
      pendingSince: () => null,
      onPendingChange: () => () => undefined,
      learner,
      learnedKey: null,
      clock: () => 0,
    };
    const enabledSeen: EnabledSources[] = [];
    hook.fake = (opts) => {
      enabledSeen.push(opts.enabled);
      return result;
    };
    const { element, api } = probe();
    const rig = renderDitApp({ overlay: element });

    expect(api().learner).toBe(learner);
    expect(api().pendingSince()).toBeNull();
    const pendingSince = api().pendingSince;
    expect(enabledSeen[0]).toStrictEqual(DEFAULT_ENABLED_SOURCES);

    result = { ...result, pendingSince: () => 1_200 };
    rig.rerender();
    expect(api().pendingSince).toBe(pendingSince);
    expect(api().pendingSince()).toBe(1_200);
    expect(api().learner).toBe(learner);
  });
});
