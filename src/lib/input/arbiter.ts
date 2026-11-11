import type { Clock } from './clock';
import {
  SOURCE_KINDS,
  err,
  isFailureStatus,
  ok,
  pressEvent,
  type PressEvent,
  type PressSource,
  type Result,
  type SourceKind,
  type Unsubscribe,
} from './types';

export interface ArbiterState {
  /** Non-null exactly while the arbiter is Held. */
  readonly holder: SourceKind | null;
  /** t of the last Press_Event in the Output_Stream. */
  readonly lastT: number | null;
  /** Sources whose next 'up' is discarded; sorted in SOURCE_KINDS order, unique. */
  readonly marks: readonly SourceKind[];
}

export const INITIAL_ARBITER_STATE: ArbiterState = Object.freeze({
  holder: null,
  lastT: null,
  marks: Object.freeze([]) as readonly SourceKind[],
});

export type ArbiterInput =
  | { readonly type: 'event'; readonly event: PressEvent }
  | { readonly type: 'detach'; readonly source: SourceKind; readonly now: number };

export interface ArbiterStep {
  readonly state: ArbiterState;
  readonly out: PressEvent | null;
}

function withMark(marks: readonly SourceKind[], source: SourceKind): readonly SourceKind[] {
  return marks.includes(source) ? marks : SOURCE_KINDS.filter((kind) => kind === source || marks.includes(kind));
}

function withoutMark(marks: readonly SourceKind[], source: SourceKind): readonly SourceKind[] {
  return marks.includes(source) ? marks.filter((kind) => kind !== source) : marks;
}

/** Rules 1 to 9 of the design, checked in order. Discarded inputs return the same state object. */
export function arbiterStep(state: ArbiterState, input: ArbiterInput): ArbiterStep {
  const unchanged: ArbiterStep = { state, out: null };

  if (input.type === 'detach') {
    // Rule 9 (Req 2.9, 2.10).
    const marks = withoutMark(state.marks, input.source);
    if (state.holder === input.source && state.lastT !== null) {
      const t = Number.isFinite(input.now) ? Math.max(input.now, state.lastT) : state.lastT;
      return { state: { holder: null, lastT: t, marks }, out: pressEvent('up', t, input.source) };
    }
    return marks === state.marks ? unchanged : { state: { ...state, marks }, out: null };
  }

  const { event } = input;
  // Rule 1 (Req 2.8).
  if (!Number.isFinite(event.t)) {
    return unchanged;
  }

  if (event.kind === 'down') {
    // Rule 2 (Req 2.8).
    if (state.lastT !== null && event.t < state.lastT) {
      return unchanged;
    }
    // Rule 3 (Req 2.1): a new Holder never keeps a mark.
    if (state.holder === null) {
      return {
        state: { holder: event.source, lastT: event.t, marks: withoutMark(state.marks, event.source) },
        out: event,
      };
    }
    // Rule 4 (Req 2.3).
    if (state.holder === event.source) {
      return unchanged;
    }
    // Rule 5 (Req 2.2): at most one mark per source.
    const marks = withMark(state.marks, event.source);
    return marks === state.marks ? unchanged : { state: { ...state, marks }, out: null };
  }

  // Rule 6 (Req 2.5, 2.7): the Holder's up is checked before any mark.
  if (state.holder === event.source && state.lastT !== null) {
    const t = Math.max(event.t, state.lastT);
    return {
      state: { holder: null, lastT: t, marks: state.marks },
      out: t === event.t ? event : pressEvent('up', t, event.source),
    };
  }
  // Rule 7 (Req 2.4).
  if (state.marks.includes(event.source)) {
    return { state: { ...state, marks: withoutMark(state.marks, event.source) }, out: null };
  }
  // Rule 8 (Req 2.6).
  return unchanged;
}

/** Engine time the consumer may safely tick to: never past the earliest pending Raw_Down (Req 2.13). */
export function safeTickTime(now: number, pendingSince: number | null): number {
  return pendingSince === null ? now : Math.min(now, pendingSince);
}

export interface ConnectError {
  readonly kind: SourceKind;
  readonly message: string;
}

export interface Arbiter {
  /** Subscribes to the source. Fails if a source of the same kind is already connected. */
  connect(source: PressSource): Result<Unsubscribe, ConnectError>;
  onOutput(listener: (event: PressEvent) => void): Unsubscribe;
  isHeld(): boolean;
  holder(): SourceKind | null;
  /** Earliest pendingSince() across connected sources, or null (Req 2.13). */
  pendingSince(): number | null;
  onPendingChange(listener: (since: number | null) => void): Unsubscribe;
}

/** Calls every listener in a snapshot of the set; a throwing listener is skipped (Req 10.10). */
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

function subscribe<T>(listeners: Set<(value: T) => void>, listener: (value: T) => void): Unsubscribe {
  const own = (value: T): void => listener(value);
  listeners.add(own);
  return () => {
    listeners.delete(own);
  };
}

/** Holds one ArbiterState and feeds it from connected sources. Reads the clock only on detach. */
export function createArbiter(clock: Clock): Arbiter {
  let state = INITIAL_ARBITER_STATE;
  const sources = new Map<SourceKind, PressSource>();
  const outputListeners = new Set<(event: PressEvent) => void>();
  const pendingListeners = new Set<(since: number | null) => void>();
  let lastPending: number | null = null;

  // Outputs are queued so that an event caused by a listener reaches every listener in order.
  const queue: PressEvent[] = [];
  let draining = false;

  const feed = (input: ArbiterInput): void => {
    const step = arbiterStep(state, input);
    state = step.state;
    if (step.out === null) return;
    queue.push(step.out);
    if (draining) return;
    draining = true;
    try {
      for (let event = queue.shift(); event !== undefined; event = queue.shift()) {
        deliverAll(outputListeners, event);
      }
    } finally {
      draining = false;
    }
  };

  const earliestPending = (): number | null => {
    let earliest: number | null = null;
    for (const source of sources.values()) {
      const since = source.pendingSince();
      if (since !== null && Number.isFinite(since) && (earliest === null || since < earliest)) {
        earliest = since;
      }
    }
    return earliest;
  };

  const refreshPending = (): void => {
    const next = earliestPending();
    if (next === lastPending) return;
    lastPending = next;
    deliverAll(pendingListeners, next);
  };

  return {
    connect(source) {
      if (sources.has(source.kind)) {
        return err({ kind: source.kind, message: `A ${source.kind} source is already connected.` });
      }
      sources.set(source.kind, source);
      const unsubscribers = [
        source.onPress((event) => feed({ type: 'event', event })),
        source.onStatus((status) => {
          if (status === 'off' || isFailureStatus(status)) {
            feed({ type: 'detach', source: source.kind, now: clock() });
          }
        }),
        source.onPending(() => refreshPending()),
      ];
      refreshPending();
      let connected = true;
      return ok(() => {
        if (!connected) return;
        connected = false;
        for (const unsubscribe of unsubscribers) unsubscribe();
        sources.delete(source.kind);
        feed({ type: 'detach', source: source.kind, now: clock() });
        refreshPending();
      });
    },
    onOutput: (listener) => subscribe(outputListeners, listener),
    isHeld: () => state.holder !== null,
    holder: () => state.holder,
    pendingSince: earliestPending,
    onPendingChange: (listener) => subscribe(pendingListeners, listener),
  };
}
