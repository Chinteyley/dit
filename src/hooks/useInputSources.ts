'use client';

import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import {
  SOURCE_KINDS,
  classifyFocus,
  createArbiter,
  createBlinkSource,
  createKeyRouter,
  createKeyboardSource,
  createPointerSource,
  createSwitchLearner,
  createSwitchSource,
  err,
  type Arbiter,
  type BlinkSource,
  type Clock,
  type InputSettings,
  type KeySource,
  type PointerSource,
  type PressEvent,
  type SettingsStore,
  type SourceKind,
  type SourceStatus,
  type SwitchLearner,
  type SwitchSource,
  type Unsubscribe,
} from '@/lib/input';
import { browserBlinkDevices } from '@/lib/input/blink/browser';
import {
  browserPage,
  browserScheduler,
  describeElement,
  documentPointerTarget,
  performanceClock,
  surfaceElement,
  windowKeyTarget,
} from '@/lib/input/browser';

export interface UseInputSourcesOptions {
  readonly surfaceRef: RefObject<HTMLElement | null>;
  /** Blink must only become true from a user action (input-sources Req 9.1). */
  readonly enabled: Readonly<Record<SourceKind, boolean>>;
  readonly settings: InputSettings;
  readonly store: SettingsStore;
  /** The Output_Stream, in order. */
  readonly onPress: (event: PressEvent) => void;
}

export interface UseInputSourcesResult {
  readonly statuses: Readonly<Record<SourceKind, SourceStatus>>;
  /** Read at timer time, not render time. */
  readonly pendingSince: () => number | null;
  readonly onPendingChange: (fn: (since: number | null) => void) => Unsubscribe;
  readonly learner: SwitchLearner;
  readonly learnedKey: string | null;
  readonly clock: Clock;
}

interface Rig {
  readonly arbiter: Arbiter;
  readonly sources: Readonly<{ keyboard: KeySource; switch: SwitchSource; pointer: PointerSource; blink: BlinkSource }>;
  readonly learner: SwitchLearner;
}

interface RigPorts {
  readonly store: () => SettingsStore;
  readonly surface: () => HTMLElement | null;
}

/** Builds the input layer for one mount. Nothing touches the DOM until a source starts. */
function buildRig(ports: RigPorts): Rig {
  const clock = performanceClock;
  const scheduler = browserScheduler;
  const page = browserPage();
  const router = createKeyRouter(windowKeyTarget());
  // The store and the surface are read when used, so new props never rebuild anything.
  const store: SettingsStore = {
    readSwitchKey: () => ports.store().readSwitchKey(),
    writeSwitchKey: (code) => ports.store().writeSwitchKey(code),
    clearSwitchKey: () => ports.store().clearSwitchKey(),
  };
  const focus = () => classifyFocus(describeElement(document.activeElement, ports.surface()));
  const keyDeps = { router, clock, scheduler, page, focus };
  const switchSource = createSwitchSource({ ...keyDeps, store });
  return {
    arbiter: createArbiter(clock),
    sources: {
      keyboard: createKeyboardSource(keyDeps),
      switch: switchSource,
      pointer: createPointerSource({
        surface: () => {
          const el = ports.surface();
          return el === null ? null : surfaceElement(el);
        },
        doc: documentPointerTarget(),
        clock,
        scheduler,
        page,
      }),
      // MediaPipe is fetched only by loadLandmarker, after blink is turned on (Req 9.1).
      blink: createBlinkSource({ devices: browserBlinkDevices(), clock, scheduler, page }),
    },
    learner: createSwitchLearner({ router, store, switchSource }),
  };
}

interface View {
  readonly statuses: Readonly<Record<SourceKind, SourceStatus>>;
  readonly learnedKey: string | null;
}

const INITIAL_VIEW: View = Object.freeze({
  statuses: Object.freeze({ keyboard: 'off', switch: 'off', pointer: 'off', blink: 'off' }),
  learnedKey: null,
});

/** The rendered part of the hook's state, as an external store for useSyncExternalStore. */
function createViewStore() {
  let view = INITIAL_VIEW;
  const listeners = new Set<() => void>();
  const publish = (next: View): void => {
    view = next;
    for (const listener of [...listeners]) listener();
  };
  return {
    get: (): View => view,
    subscribe(listener: () => void): Unsubscribe {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    setStatus(kind: SourceKind, status: SourceStatus): void {
      if (view.statuses[kind] !== status) publish({ ...view, statuses: { ...view.statuses, [kind]: status } });
    },
    setLearnedKey(learnedKey: string | null): void {
      if (view.learnedKey !== learnedKey) publish({ ...view, learnedKey });
    },
  };
}

/**
 * Connects the keyboard, switch, pointer and blink sources to one Input_Arbiter, starts and stops
 * them from the enabled flags, and forwards the merged Press_Events to `onPress`. The input layer
 * is built when the component mounts and torn down when it unmounts; the returned functions and
 * learner keep their identity for the component's lifetime.
 */
export function useInputSources(opts: UseInputSourcesOptions): UseInputSourcesResult {
  const { enabled, settings } = opts;
  const rigRef = useRef<Rig | null>(null);

  const [stable] = useState(() => {
    const view = createViewStore();
    const pendingListeners = new Set<(since: number | null) => void>();
    const refreshLearnedKey = (): void => {
      const rig = rigRef.current;
      if (rig !== null) view.setLearnedKey(rig.sources.switch.learnedKey());
    };
    const learner: SwitchLearner = {
      arm() {
        const rig = rigRef.current;
        if (rig === null) {
          return Promise.resolve(err({ reason: 'cancelled', message: 'Switch learning is not available yet.' }));
        }
        return rig.learner.arm().then((result) => {
          refreshLearnedKey();
          return result;
        });
      },
      cancel: () => rigRef.current?.learner.cancel(),
      isArmed: () => rigRef.current?.learner.isArmed() ?? false,
      clear() {
        const rig = rigRef.current;
        if (rig === null) return err({ reason: 'save-failed', message: 'The switch key could not be cleared yet.' });
        const result = rig.learner.clear();
        refreshLearnedKey();
        return result;
      },
    };
    return {
      view,
      pendingListeners,
      refreshLearnedKey,
      learner,
      pendingSince: (): number | null => rigRef.current?.arbiter.pendingSince() ?? null,
      onPendingChange(fn: (since: number | null) => void): Unsubscribe {
        const own = (since: number | null): void => fn(since);
        pendingListeners.add(own);
        return () => {
          pendingListeners.delete(own);
        };
      },
    };
  });
  const view = useSyncExternalStore(stable.view.subscribe, stable.view.get, stable.view.get);

  const deliverPress = useEffectEvent((event: PressEvent) => opts.onPress(event));
  const currentStore = useEffectEvent((): SettingsStore => opts.store);
  const currentSurface = useEffectEvent((): HTMLElement | null => opts.surfaceRef.current);

  // Build and connect once per mount; unmount stops and disconnects every source.
  useEffect(() => {
    const rig = buildRig({ store: () => currentStore(), surface: () => currentSurface() });
    rigRef.current = rig;
    const cleanups: Unsubscribe[] = [
      rig.arbiter.onOutput((event) => deliverPress(event)),
      rig.arbiter.onPendingChange((since) => {
        for (const listener of [...stable.pendingListeners]) {
          try {
            listener(since);
          } catch {
            // One subscriber must not break the others.
          }
        }
      }),
    ];
    for (const kind of SOURCE_KINDS) {
      const source = rig.sources[kind];
      cleanups.push(source.onStatus((status) => stable.view.setStatus(kind, status)));
      const connected = rig.arbiter.connect(source);
      if (connected.ok) cleanups.push(connected.value);
    }
    return () => {
      rig.learner.cancel();
      for (const kind of SOURCE_KINDS) rig.sources[kind].stop();
      for (const cleanup of cleanups.reverse()) cleanup();
      if (rigRef.current === rig) rigRef.current = null;
    };
  }, [stable]);

  // Validated by the conversation layer first, so failed Results are ignored here.
  useEffect(() => {
    const rig = rigRef.current;
    if (rig === null) return;
    const { minPressDuration, closeThreshold, openThreshold } = settings;
    rig.sources.keyboard.setMinPressDuration(minPressDuration.keyboard);
    rig.sources.switch.setMinPressDuration(minPressDuration.switch);
    rig.sources.pointer.setMinPressDuration(minPressDuration.pointer);
    rig.sources.blink.setMinPressDuration(minPressDuration.blink);
    rig.sources.blink.setThresholds(closeThreshold, openThreshold);
  }, [settings]);

  useEffect(() => {
    const rig = rigRef.current;
    if (rig === null || !enabled.keyboard) return;
    rig.sources.keyboard.start();
    return () => rig.sources.keyboard.stop();
  }, [enabled.keyboard]);

  useEffect(() => {
    const rig = rigRef.current;
    if (rig === null || !enabled.switch) return;
    rig.sources.switch.start();
    stable.refreshLearnedKey();
    return () => rig.sources.switch.stop();
  }, [stable, enabled.switch]);

  useEffect(() => {
    const rig = rigRef.current;
    if (rig === null || !enabled.pointer) return;
    rig.sources.pointer.start();
    return () => rig.sources.pointer.stop();
  }, [enabled.pointer]);

  useEffect(() => {
    const rig = rigRef.current;
    if (rig === null || !enabled.blink) return;
    rig.sources.blink.start();
    return () => rig.sources.blink.stop();
  }, [enabled.blink]);

  return {
    statuses: view.statuses,
    pendingSince: stable.pendingSince,
    onPendingChange: stable.onPendingChange,
    learner: stable.learner,
    learnedKey: view.learnedKey,
    clock: performanceClock,
  };
}
