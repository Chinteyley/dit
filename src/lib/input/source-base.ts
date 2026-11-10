import type { Clock, Scheduler } from './clock';
import type { Debouncer } from './debounce';
import type { PressEvent, PressSource, SourceKind, SourceStatus, Unsubscribe } from './types';

/** browser.ts binds this to window 'blur' and document 'visibilitychange'. */
export interface PageLifecycle {
  isHidden(): boolean;
  onBlur(fn: () => void): Unsubscribe;
  onHidden(fn: () => void): Unsubscribe;
  onVisible(fn: () => void): Unsubscribe;
}

export interface SourceCore {
  readonly kind: SourceKind;
  readonly debouncer: Debouncer;
  /** Delivers events to a snapshot of the press listeners. */
  emit(events: readonly PressEvent[]): void;
  /** Delivers only on change (Req 1.7). */
  setStatus(next: SourceStatus): void;
  status(): SourceStatus;
  /** Wraps a Debouncer call: emits its events and updates the confirmation timer and pending listeners. */
  feed(call: (d: Debouncer) => readonly PressEvent[]): void;
  /** Ends or discards the current press: cancel() then forceUp(clock()). Idempotent (Req 7.7). */
  endPress(): void;
  readonly subscribers: Pick<PressSource, 'onPress' | 'onStatus' | 'onPending' | 'pendingSince'>;
}

type Delivery =
  | { readonly type: 'press'; readonly event: PressEvent }
  | { readonly type: 'status'; readonly status: SourceStatus }
  | { readonly type: 'pending'; readonly since: number | null };

function addListener<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
  const own = (value: T): void => listener(value);
  listeners.add(own);
  return () => {
    listeners.delete(own);
  };
}

/** Calls each listener of a snapshot that is still subscribed; errors are dropped (Req 1.10, 10.10). */
function deliverAll<T>(listeners: ReadonlySet<(value: T) => void>, value: T): void {
  for (const listener of [...listeners]) {
    if (!listeners.has(listener)) continue;
    try {
      listener(value);
    } catch {
      // Dropped on purpose: one subscriber must not break delivery to the others.
    }
  }
}

/**
 * The contract rules shared by every source (Requirements 1 and 7). Press events, status changes
 * and pending changes go through one queue, so a listener that reacts synchronously (for example
 * by stopping the source) never reorders them: a Held press's `up` always arrives before 'off'.
 * With a `null` scheduler (blink) no confirmation timer is used; frames call advance instead.
 */
export function createSourceCore(
  kind: SourceKind,
  clock: Clock,
  scheduler: Scheduler | null,
  debouncer: Debouncer,
): SourceCore {
  const pressListeners = new Set<(event: PressEvent) => void>();
  const statusListeners = new Set<(status: SourceStatus) => void>();
  const pendingListeners = new Set<(since: number | null) => void>();
  let current: SourceStatus = 'off';
  let lastPending: number | null = null;
  let timer: { readonly deadline: number; readonly cancel: () => void } | null = null;

  const queue: Delivery[] = [];
  let draining = false;
  const enqueue = (item: Delivery): void => {
    queue.push(item);
    if (draining) return;
    draining = true;
    try {
      for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
        if (next.type === 'press') deliverAll(pressListeners, next.event);
        else if (next.type === 'status') deliverAll(statusListeners, next.status);
        else deliverAll(pendingListeners, next.since);
      }
    } finally {
      draining = false;
    }
  };

  const emit = (events: readonly PressEvent[]): void => {
    for (const event of events) enqueue({ type: 'press', event });
  };

  const cancelTimer = (): void => {
    timer?.cancel();
    timer = null;
  };

  const sync = (): void => {
    const deadline = debouncer.deadline();
    if (deadline === null || scheduler === null) {
      cancelTimer();
    } else if (timer === null || timer.deadline !== deadline) {
      cancelTimer();
      const cancel = scheduler.schedule(deadline - clock(), check);
      timer = { deadline, cancel };
    }
    const since = debouncer.pendingSince();
    if (since !== lastPending) {
      lastPending = since;
      enqueue({ type: 'pending', since });
    }
  };

  const feed = (call: (d: Debouncer) => readonly PressEvent[]): void => {
    const events = call(debouncer);
    // Press events go out before the pending change: a consumer told "nothing pending" may tick
    // the engine at once, and the down it was waiting for must already be there (Req 2.13).
    emit(events);
    sync();
  };

  // Fires at or after the deadline. A timer that fires early reschedules through sync().
  function check(): void {
    timer = null;
    feed((d) => d.advance(clock()));
  }

  return {
    kind,
    debouncer,
    emit,
    setStatus(next) {
      if (next === current) return;
      current = next;
      enqueue({ type: 'status', status: next });
    },
    status: () => current,
    feed,
    endPress() {
      feed((d) => {
        d.cancel();
        return d.forceUp(clock());
      });
    },
    subscribers: {
      onPress: (listener) => addListener(pressListeners, listener),
      onStatus: (listener) => addListener(statusListeners, listener),
      onPending: (listener) => addListener(pendingListeners, listener),
      pendingSince: () => debouncer.pendingSince(),
    },
  };
}
