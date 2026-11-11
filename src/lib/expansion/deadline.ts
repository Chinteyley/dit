/** Timer functions, injected so tests can drive time with fake timers. */
export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type DeadlineOutcome<T> =
  | { readonly kind: 'ok'; readonly value: T }
  | { readonly kind: 'timeout' }
  /** The external signal fired first. */
  | { readonly kind: 'aborted' }
  | { readonly kind: 'error'; readonly error: unknown };

export interface DeadlineOptions {
  readonly ms: number;
  readonly timers: Timers;
  readonly signal?: AbortSignal;
}

/**
 * Runs `work` with its own AbortSignal and settles exactly once with the first of: work
 * resolves (`ok`), work rejects (`error`), the injected timer fires (`timeout`, and the signal is
 * aborted), or the external signal aborts (`aborted`, and the signal is aborted). The timer is
 * cleared and the external listener removed on settlement; later results are ignored and a late
 * rejection is handled, so it cannot become an unhandled rejection. `work` should include
 * reading the full body, so the deadline covers the complete response.
 */
export function runWithDeadline<T>(
  work: (signal: AbortSignal) => Promise<T>,
  opts: DeadlineOptions,
): Promise<DeadlineOutcome<T>> {
  return new Promise((resolve) => {
    const inner = new AbortController();
    const external = opts.signal;
    let settled = false;
    // Set once the timer starts below; finish() may run before that (an already aborted signal).
    let handle: unknown = undefined;

    const finish = (outcome: DeadlineOutcome<T>, abortWork: boolean): void => {
      if (settled) return;
      settled = true;
      opts.timers.clearTimeout(handle);
      external?.removeEventListener('abort', onExternalAbort);
      if (abortWork) inner.abort();
      resolve(outcome);
    };
    const onExternalAbort = (): void => finish({ kind: 'aborted' }, true);

    if (external?.aborted === true) {
      finish({ kind: 'aborted' }, true);
      return;
    }
    external?.addEventListener('abort', onExternalAbort);
    handle = opts.timers.setTimeout(() => finish({ kind: 'timeout' }, true), opts.ms);

    let pending: Promise<T>;
    try {
      pending = Promise.resolve(work(inner.signal));
    } catch (error) {
      finish({ kind: 'error', error }, false);
      return;
    }
    pending.then(
      (value) => finish({ kind: 'ok', value }, false),
      (error: unknown) => finish({ kind: 'error', error }, false),
    );
  });
}
