'use client';

/**
 * React wiring for the SessionController (design "hooks/useMorseSession.ts", task 10.1). The
 * controller is created in a mount effect, so React strict mode's double mount builds, disposes
 * and rebuilds it, and server rendering never touches a browser API. Components read the
 * controller's snapshot through useSyncExternalStore and call a stable facade that forwards to
 * whichever controller is live, so the returned `controller` keeps its identity for the whole
 * mount, and calls made before the controller exists (child effects run before this hook's
 * effect) are not lost where it matters.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  DEFAULT_SETTINGS,
  INITIAL_SESSION,
  createConversationStorage,
  memoryBackend,
  type AlarmHandler,
  type ConversationStorage,
  type UnknownPatternHandler,
} from '@/lib/conversation';
import { localStorageBackend } from '@/lib/conversation/browser';
import { createExpansionClient, expandOnDevice, type Timers } from '@/lib/expansion';
import { err, type Clock, type Unsubscribe } from '@/lib/input';
import { browserScheduler } from '@/lib/input/browser';
import { createEngine, type Estimates } from '@/lib/morse';
import { clearStoredCalibration } from '@/lib/onboarding';
import { initialListen } from '@/lib/speech';
import { webSpeechInput, webSpeechOutput } from '@/lib/speech/browser';
import {
  createSessionController,
  engineOrDefault,
  type ControllerDeps,
  type SessionController,
  type SessionSnapshot,
} from './session-controller';

/** Test seam: replaces the browser adapters. */
export type SessionOverrides = Partial<
  Pick<ControllerDeps, 'scheduler' | 'createEngine' | 'createClient' | 'speechOutput' | 'speechInput' | 'storage'>
>;

export interface UseMorseSessionOptions {
  readonly alarm: AlarmHandler;
  readonly unknownPattern: UnknownPatternHandler;
  /** From useInputSources; read at timer time, so a new callback never rebuilds the controller. */
  readonly pendingSince: () => number | null;
  /** From useInputSources (performance.now base). */
  readonly clock: Clock;
  /** Read once, when the component mounts. */
  readonly overrides?: SessionOverrides | undefined;
}

export interface UseMorseSessionResult {
  readonly snapshot: SessionSnapshot;
  /** Stable for the whole mount; forwards to the live controller. Its dispose() does nothing. */
  readonly controller: SessionController;
  /** The storage the controller uses; DitApp hands the same object to useInputSources as its store. */
  readonly storage: ConversationStorage;
  /** False until the controller exists and its first snapshot (with the hydrated history) is shown. */
  readonly ready: boolean;
}

/** What renders before the controller exists: on the server, while hydrating and before the mount effect. */
export const INITIAL_SNAPSHOT: SessionSnapshot = Object.freeze({
  session: INITIAL_SESSION,
  settings: DEFAULT_SETTINGS,
  pressed: false,
  alarmActive: false,
  // Optimistic until the controller asks the browser, so supported browsers show no flash of the
  // "not supported" text; the switch does nothing before then.
  listen: initialListen(true),
  voices: Object.freeze([]),
  announcement: null,
  messages: Object.freeze([]),
});

const getServerSnapshot = (): SessionSnapshot => INITIAL_SNAPSHOT;

interface SessionHolder {
  readonly controller: SessionController;
  attach(live: SessionController): void;
  detach(): void;
}

/** A stable facade over whichever controller is live (none on the server and before mount). */
function createSessionHolder(): SessionHolder {
  let live: SessionController | null = null;
  let detachers: Unsubscribe[] = [];
  /** The last setInitialEstimates value, re-applied to a controller that attaches later. */
  let estimates: { readonly value: Estimates | null } | null = null;
  const subscribers = new Set<() => void>();
  const charListeners = new Set<(char: string) => void>();

  const notify = (): void => {
    for (const listener of [...subscribers]) listener();
  };

  const controller: SessionController = {
    handlePress: (event) => live?.handlePress(event),
    partnerPick: (index) => live?.partnerPick(index),
    partnerLine: (text) => live?.partnerLine(text),
    clearHistory: () => live?.clearHistory(),
    // Before the controller exists nothing can be applied, so nothing is reported as applied.
    updateSettings(patch) {
      if (live === null) return err([]);
      const before = live.getSnapshot().settings.startingWpm;
      const result = live.updateSettings(patch);
      if (result.ok && result.value.startingWpm !== before) estimates = { value: null };
      return result;
    },
    updateInputSettings: (input) => live?.updateInputSettings(input),
    setInitialEstimates(value) {
      // Onboarding may call this from a child mount effect, which runs before the controller exists.
      estimates = { value };
      live?.setInitialEstimates(value);
    },
    getEstimates: () => live?.getEstimates() ?? estimates?.value ?? null,
    setListen: (on) => live?.setListen(on),
    setSourceStatuses: (statuses) => live?.setSourceStatuses(statuses),
    dismissMessage: (id) => live?.dismissMessage(id),
    discardInput: () => live?.discardInput(),
    onCodeCommitted(listener) {
      charListeners.add(listener);
      return () => {
        charListeners.delete(listener);
      };
    },
    getSnapshot: () => live?.getSnapshot() ?? INITIAL_SNAPSHOT,
    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },
    // The hook owns the controller's lifetime.
    dispose: () => undefined,
  };

  return {
    controller,
    attach(next) {
      live = next;
      detachers = [
        next.subscribe(notify),
        next.onCodeCommitted((char) => {
          for (const listener of [...charListeners]) {
            try {
              listener(char);
            } catch {
              // Ignored, as the controller does: other listeners still run.
            }
          }
        }),
      ];
      if (estimates !== null) next.setInitialEstimates(estimates.value);
      notify();
    },
    detach() {
      for (const detachOne of detachers.splice(0)) detachOne();
      const current = live;
      live = null;
      current?.dispose();
    },
  };
}

const browserTimers: Timers = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (handle) => {
    if (typeof handle === 'number') window.clearTimeout(handle);
  },
};

/** The expansion client with the browser's fetch, timers and online flag (Req 9). */
const browserClient: ControllerDeps['createClient'] = (onResult) =>
  createExpansionClient(
    {
      fetch: (input, init) => window.fetch(input, init),
      timers: browserTimers,
      isOnline: () => navigator.onLine,
      expandOnDevice,
    },
    onResult,
  );

interface Setup {
  readonly overrides: SessionOverrides;
  readonly storage: ConversationStorage;
  /** False when localStorage is unavailable and history lives in memory (Req 16.9). */
  readonly persistent: boolean;
  readonly holder: SessionHolder;
}

function createSetup(overrides: SessionOverrides | undefined): Setup {
  const given = overrides ?? {};
  if (given.storage !== undefined) {
    return { overrides: given, storage: given.storage, persistent: true, holder: createSessionHolder() };
  }
  // On the server this falls back to memory; the client builds its own setup while hydrating.
  const backend = localStorageBackend();
  return {
    overrides: given,
    storage: createConversationStorage(backend ?? memoryBackend()),
    persistent: backend !== null,
    holder: createSessionHolder(),
  };
}

export function useMorseSession(opts: UseMorseSessionOptions): UseMorseSessionResult {
  const [setup] = useState(() => createSetup(opts.overrides));
  const latest = useRef(opts);
  useEffect(() => {
    latest.current = opts;
  });

  useEffect(() => {
    const { overrides, storage, persistent, holder } = setup;
    // The alarm, the unknown-pattern handler, the clock and pendingSince are read at call time,
    // so new callbacks from a parent render never rebuild the controller.
    const alarm: AlarmHandler = {
      start: () => latest.current.alarm.start(),
      isActive: () => latest.current.alarm.isActive(),
      handlePress: (event) => latest.current.alarm.handlePress(event),
      onActiveChange: (listener) => latest.current.alarm.onActiveChange(listener),
    };
    const deps: ControllerDeps = {
      clock: () => latest.current.clock(),
      scheduler: overrides.scheduler ?? browserScheduler,
      createEngine: overrides.createEngine ?? engineOrDefault(createEngine),
      pendingSince: () => latest.current.pendingSince(),
      createClient: overrides.createClient ?? browserClient,
      speechOutput: overrides.speechOutput ?? webSpeechOutput(window),
      speechInput: overrides.speechInput ?? webSpeechInput(window),
      alarm,
      unknownPattern: { handle: (pattern) => latest.current.unknownPattern.handle(pattern) },
      storage,
      persistent,
      clearCalibration: () => clearStoredCalibration(localStorageBackend()).ok,
    };
    holder.attach(createSessionController(deps));
    return () => holder.detach();
  }, [setup]);

  const { controller } = setup.holder;
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, getServerSnapshot);
  return { snapshot, controller, storage: setup.storage, ready: snapshot !== INITIAL_SNAPSHOT };
}
