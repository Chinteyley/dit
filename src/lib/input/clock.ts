/** Returns the current time in ms, finite, in the same base for every source (performance.now()). */
export type Clock = () => number;

export interface Scheduler {
  /** Calls fn once at or after `delayMs`. Returns a cancel function. */
  schedule(delayMs: number, fn: () => void): () => void;
}

/** A clock that only moves when told to. Pure fake for tests and scripted replays. */
export interface ManualClock {
  readonly now: Clock;
  set(t: number): void;
  advance(ms: number): void;
}

export function createManualClock(start = 0): ManualClock {
  let current = start;
  return {
    now: () => current,
    set(t) {
      current = t;
    },
    advance(ms) {
      current += ms;
    },
  };
}

/** A scheduler whose timers fire only from runDue(now). */
export interface ManualScheduler extends Scheduler {
  /** Fires every live timer due at or before `now`, earliest first (ties in scheduling order). */
  runDue(now: number): void;
  /** Number of live timers: scheduled, not yet fired and not cancelled. */
  pending(): number;
}

interface ManualTimer {
  readonly id: number;
  readonly due: number;
  readonly fn: () => void;
}

/** Upper bound on timers fired by one runDue call; more means a timer keeps rescheduling itself at `now`. */
const MAX_FIRES_PER_RUN = 100_000;

/**
 * Timers are due at `base + delayMs`, where `base` is `clock()` when a clock is given and otherwise the
 * latest `runDue(now)` value (0 before the first call). Non-finite or negative delays count as 0, as
 * with setTimeout. Timers scheduled while runDue is firing are fired in the same call when due.
 */
export function createManualScheduler(clock?: Clock): ManualScheduler {
  let timers: ManualTimer[] = [];
  let nextId = 0;
  let lastRun = 0;

  const remove = (id: number): void => {
    timers = timers.filter((timer) => timer.id !== id);
  };

  return {
    schedule(delayMs, fn) {
      const delay = Number.isFinite(delayMs) ? Math.max(0, delayMs) : 0;
      const id = nextId++;
      timers.push({ id, due: (clock?.() ?? lastRun) + delay, fn });
      return () => remove(id);
    },
    runDue(now) {
      lastRun = Math.max(lastRun, now);
      for (let fired = 0; ; fired++) {
        if (fired >= MAX_FIRES_PER_RUN) {
          throw new Error('ManualScheduler.runDue: a timer keeps rescheduling itself');
        }
        let next: ManualTimer | undefined;
        for (const timer of timers) {
          if (timer.due <= now && (next === undefined || timer.due < next.due)) {
            next = timer;
          }
        }
        if (next === undefined) {
          return;
        }
        remove(next.id);
        next.fn();
      }
    },
    pending: () => timers.length,
  };
}
