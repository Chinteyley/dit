// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useRetryWhenAllowed } from './useRetryWhenAllowed';

/** A PermissionStatus stand-in whose state the test changes. */
function fakePermission(initial: PermissionState) {
  const status = Object.assign(new EventTarget(), { state: initial });
  Object.defineProperty(navigator, 'permissions', {
    configurable: true,
    value: { query: vi.fn(async () => status) },
  });
  return status;
}

const flush = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useRetryWhenAllowed', () => {
  it('retries when the permission changes to granted', async () => {
    const status = fakePermission('denied');
    const retry = vi.fn();
    renderHook(() => useRetryWhenAllowed(true, 'microphone', retry));
    await flush();
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(retry).not.toHaveBeenCalled();
    status.state = 'granted';
    status.dispatchEvent(new Event('change'));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('retries on return while granted, once per return, and never while inactive', async () => {
    fakePermission('granted');
    const retry = vi.fn();
    const { rerender } = renderHook(({ active }) => useRetryWhenAllowed(active, 'camera', retry), {
      initialProps: { active: false },
    });
    window.dispatchEvent(new Event('focus'));
    await flush();
    expect(retry).not.toHaveBeenCalled();
    rerender({ active: true });
    await flush();
    window.dispatchEvent(new Event('focus'));
    document.dispatchEvent(new Event('visibilitychange'));
    await flush();
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
