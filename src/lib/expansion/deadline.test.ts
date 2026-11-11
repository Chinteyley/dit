import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runWithDeadline, type Timers } from './deadline';

const timers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void } {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const unhandled: unknown[] = [];
const onUnhandled = (reason: unknown): void => {
  unhandled.push(reason);
};

beforeEach(() => {
  vi.useFakeTimers();
  unhandled.length = 0;
  process.on('unhandledRejection', onUnhandled);
});

afterEach(() => {
  process.off('unhandledRejection', onUnhandled);
  vi.useRealTimers();
});

describe('runWithDeadline', () => {
  it('resolves ok when the work finishes in time and clears the timer', async () => {
    const outcome = runWithDeadline(async () => 'done', { ms: 1_000, timers });
    await expect(outcome).resolves.toStrictEqual({ kind: 'ok', value: 'done' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a rejection as error', async () => {
    const error = new Error('boom');
    await expect(runWithDeadline(() => Promise.reject(error), { ms: 1_000, timers })).resolves.toStrictEqual({ kind: 'error', error });
  });

  it('reports a synchronous throw as error', async () => {
    const error = new Error('sync');
    const work = (): Promise<never> => {
      throw error;
    };
    await expect(runWithDeadline(work, { ms: 1_000, timers })).resolves.toStrictEqual({ kind: 'error', error });
  });

  it('times out work that ignores its signal, and aborts the signal', async () => {
    let seen: AbortSignal | undefined;
    const work = deferred<string>();
    const outcome = runWithDeadline(
      (signal) => {
        seen = signal;
        return work.promise;
      },
      { ms: 4_000, timers },
    );
    await vi.advanceTimersByTimeAsync(3_999);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(outcome).resolves.toStrictEqual({ kind: 'timeout' });
    expect(seen?.aborted).toBe(true);
  });

  it('ignores a late resolve or reject after the timeout without an unhandled rejection', async () => {
    const late = deferred<string>();
    const outcome = runWithDeadline(() => late.promise, { ms: 100, timers });
    await vi.advanceTimersByTimeAsync(100);
    await expect(outcome).resolves.toStrictEqual({ kind: 'timeout' });
    late.reject(new Error('late'));
    await vi.advanceTimersByTimeAsync(10);
    expect(unhandled).toStrictEqual([]);

    const lateOk = deferred<string>();
    const second = runWithDeadline(() => lateOk.promise, { ms: 100, timers });
    await vi.advanceTimersByTimeAsync(100);
    lateOk.resolve('late value');
    await expect(second).resolves.toStrictEqual({ kind: 'timeout' });
  });

  it('reports an external abort as aborted, aborts the work and clears the timer', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;
    const outcome = runWithDeadline(
      (signal) => {
        seen = signal;
        return new Promise<string>((_, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
      },
      { ms: 5_000, timers, signal: controller.signal },
    );
    controller.abort();
    await expect(outcome).resolves.toStrictEqual({ kind: 'aborted' });
    expect(seen?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not start the work when the external signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const work = vi.fn(async () => 'never');
    await expect(runWithDeadline(work, { ms: 5_000, timers, signal: controller.signal })).resolves.toStrictEqual({ kind: 'aborted' });
    expect(work).not.toHaveBeenCalled();
  });

  it('removes the external abort listener once settled', async () => {
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await runWithDeadline(async () => 1, { ms: 5_000, timers, signal: controller.signal });
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
