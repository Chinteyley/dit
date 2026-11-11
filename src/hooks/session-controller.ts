/**
 * The SessionController (design "hooks/session-controller.ts", Requirements 5, 8, 9, 16 to 18,
 * 20 and 22): a framework-free object that owns the Engine, the single Tick_Timer, the effect
 * runner, the alarm routing, the Client calls, speech and storage. Clock, scheduler, Engine
 * factory, Client, speech, storage and the alarm are injected, so tests drive it with fakes and
 * a manual clock. It lives under src/hooks because it has side effects; it imports no React.
 */
import {
  INITIAL_LIVE_QUEUE,
  INITIAL_SESSION,
  InputSettingsSchema,
  announcementsFor,
  contextWindow,
  engineConfigOf,
  enqueue,
  flush,
  reduce,
  trimmedText,
  validateSettingsPatch,
  type AlarmHandler,
  type ConversationStorage,
  type LiveItem,
  type LiveStep,
  type PatchError,
  type SessionAction,
  type SessionEffect,
  type SessionState,
  type SettingsPatch,
  type SettingsRecord,
  type UnknownPatternHandler,
} from '@/lib/conversation';
import { trimWhitespace, type ExpansionClient, type ExpansionResult } from '@/lib/expansion';
import {
  SOURCE_KINDS,
  safeTickTime,
  type Clock,
  type InputSettings,
  type PressEvent,
  type Scheduler,
  type SourceKind,
  type SourceStatus,
  type Unsubscribe,
} from '@/lib/input';
import { ok, type Engine, type EngineConfig, type Estimates, type Result } from '@/lib/morse';
import {
  initialListen,
  listenStep,
  type ListenInput,
  type ListenState,
  type SpeechInput,
  type SpeechOutput,
  type VoiceInfo,
} from '@/lib/speech';

/** Retry delay while a Pending_Press is older than the deadline (Req 8.5). */
export const PENDING_RETRY_MS = 50;
/** Delay before recognition restarts after it ended on its own (Req 18.9 asks for 1,000 ms at most). */
export const LISTEN_RESTART_MS = 250;

export interface ControllerDeps {
  readonly clock: Clock;
  /** Runs the Tick_Timer. */
  readonly scheduler: Scheduler;
  /**
   * Runs the Live_Region flush and Listen restart timers; defaults to `scheduler`. Tests pass a
   * separate one so `scheduler` holds Tick_Timers only (Req 23.4).
   */
  readonly uiScheduler?: Scheduler;
  /** Wraps the morse createEngine; falls back to the defaults on a failed Result. */
  readonly createEngine: (config: EngineConfig) => Engine;
  /** The arbiter's earliest pending Raw_Down, read at timer time. */
  readonly pendingSince: () => number | null;
  readonly createClient: (onResult: (result: ExpansionResult) => void) => ExpansionClient;
  readonly speechOutput: SpeechOutput;
  readonly speechInput: SpeechInput;
  readonly alarm: AlarmHandler;
  readonly unknownPattern: UnknownPatternHandler;
  readonly storage: ConversationStorage;
  /**
   * False when the storage is an in-memory fallback because localStorage is unavailable; the
   * save-failure message is then shown once from the start (Req 16.9). Defaults to true.
   */
  readonly persistent?: boolean;
  readonly clearCalibration?: () => boolean;
}

export const SAVE_FAILED_TEXT = 'History or settings could not be saved on this device.';
export const NO_VOICE_TEXT = 'No voice is available on this device. The sentence is shown on the display.';
export const SPEAK_ERROR_TEXT = 'The sentence could not be spoken.';

export type StatusMessage =
  | { readonly id: 'save-failed'; readonly text: typeof SAVE_FAILED_TEXT }
  | { readonly id: 'no-voice'; readonly text: typeof NO_VOICE_TEXT }
  | { readonly id: 'speak-error'; readonly text: typeof SPEAK_ERROR_TEXT }
  | { readonly id: `source-${SourceKind}`; readonly text: string };

const SOURCE_LABEL: Readonly<Record<SourceKind, string>> = {
  keyboard: 'Keyboard input',
  switch: 'Switch input',
  pointer: 'Tap input',
  blink: 'Blink input',
};

const STATUS_TEXT: Readonly<Record<Exclude<SourceStatus, 'off' | 'active'>, string>> = {
  starting: 'starting',
  'face-lost': 'face not found',
  'permission-denied': 'camera permission denied',
  'no-camera': 'no camera found',
  unsupported: 'not supported in this browser',
  error: 'stopped because of an error',
};

/** For example "Blink input: camera permission denied." (Req 22.12). */
export function sourceStatusText(kind: SourceKind, status: Exclude<SourceStatus, 'off' | 'active'>): string {
  return `${SOURCE_LABEL[kind]}: ${STATUS_TEXT[status]}.`;
}

export interface SessionSnapshot {
  readonly session: SessionState;
  readonly settings: SettingsRecord;
  /** The last Press_Event kind was 'down' (any source, alarm or not). */
  readonly pressed: boolean;
  readonly alarmActive: boolean;
  readonly listen: ListenState;
  readonly voices: readonly VoiceInfo[];
  readonly announcement: { readonly seq: number; readonly text: string } | null;
  /** One per id, in insertion order. */
  readonly messages: readonly StatusMessage[];
}

export interface SessionController {
  handlePress(event: PressEvent): void;
  partnerPick(index: number): void;
  partnerLine(text: string): void;
  clearHistory(): void;
  updateSettings(patch: SettingsPatch): Result<SettingsRecord, readonly PatchError[]>;
  updateInputSettings(input: InputSettings): void;
  /** From onboarding-and-safety calibration; null builds the Engine from the Starting_WPM defaults. */
  setInitialEstimates(estimates: Estimates | null): void;
  /** Current calibrated/adapted press timing, for cancelling setup without losing the prior rhythm. */
  getEstimates(): Estimates | null;
  setListen(on: boolean): void;
  setSourceStatuses(statuses: Readonly<Record<SourceKind, SourceStatus>>): void;
  dismissMessage(id: StatusMessage['id']): void;
  /** Integration point: called by a Press_Router when presses start or stop going elsewhere (onboarding O12.10). */
  discardInput(): void;
  /** Integration point: fires once per committed character or command the session applies (onboarding O10.3). */
  onCodeCommitted(listener: (char: string) => void): Unsubscribe;
  /** The same object until something changes. */
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): Unsubscribe;
  dispose(): void;
}

const isQuiet = (status: SourceStatus): status is 'off' | 'active' => status === 'off' || status === 'active';

export function createSessionController(deps: ControllerDeps): SessionController {
  const { clock, scheduler, storage, alarm, speechOutput, speechInput } = deps;
  const uiScheduler = deps.uiScheduler ?? scheduler;

  let disposed = false;
  let session: SessionState = INITIAL_SESSION;
  let settings: SettingsRecord;
  let estimates: Estimates | null = null;
  let engine: Engine;
  let tickCancel: (() => void) | null = null;
  /** A `down` reached the current Engine without its `up`. */
  let engineHeld = false;
  /** Drop the next `up`: alarm start, Engine replacement or discardInput() during a press. */
  let withholdUp = false;
  let pressed = false;
  let alarmActive = alarm.isActive();
  let live = INITIAL_LIVE_QUEUE;
  let flushCancel: (() => void) | null = null;
  let announcement: SessionSnapshot['announcement'] = null;
  let listen: ListenState = initialListen(speechInput.isSupported());
  let restartCancel: (() => void) | null = null;
  let voices: readonly VoiceInfo[] = speechOutput.voices();
  let messages: readonly StatusMessage[] = [];
  let speechEndedAt = -Infinity;
  let lastSpokenSentence = '';
  const normalizedSentence = (text: string): string => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

  const subscribers = new Set<() => void>();
  const charListeners = new Set<(char: string) => void>();
  const unsubscribers: Unsubscribe[] = [];

  // ---- snapshot and notification -------------------------------------------------------------

  let snapshot: SessionSnapshot | null = null;
  let dirty = false;
  let depth = 0;

  const changed = (): void => {
    snapshot = null;
    dirty = true;
  };

  const notifyNow = (): void => {
    if (!dirty || disposed) return;
    dirty = false;
    for (const listener of [...subscribers]) {
      try {
        listener();
      } catch {
        // A failing subscriber must not stop the others.
      }
    }
  };

  /** Runs fn and notifies subscribers once at the end of the outermost call. */
  const batch = (fn: () => void): void => {
    depth += 1;
    try {
      fn();
    } finally {
      depth -= 1;
      if (depth === 0) notifyNow();
    }
  };

  const addMessage = (message: StatusMessage): void => {
    const at = messages.findIndex((m) => m.id === message.id);
    if (at === -1) {
      messages = [...messages, message];
      changed();
    } else if (messages[at]?.text !== message.text) {
      messages = messages.map((m, i) => (i === at ? message : m));
      changed();
    }
  };

  const removeMessage = (id: StatusMessage['id']): void => {
    if (!messages.some((m) => m.id === id)) return;
    messages = messages.filter((m) => m.id !== id);
    changed();
  };

  const saveFailed = (): void => addMessage({ id: 'save-failed', text: SAVE_FAILED_TEXT });

  // ---- timers --------------------------------------------------------------------------------

  const cancelTick = (): void => {
    const cancel = tickCancel;
    tickCancel = null;
    cancel?.();
  };

  /** Cancel the Tick_Timer, then schedule one for the Engine's next deadline, if any (Req 8.3). */
  const reschedule = (): void => {
    cancelTick();
    if (disposed || alarm.isActive()) return;
    const deadline = engine.nextDeadline();
    if (deadline === null || !Number.isFinite(deadline)) return;
    tickCancel = scheduler.schedule(Math.max(0, deadline - clock()), () => fire(deadline));
  };

  /** Tick_Timer callback (Req 8.4 to 8.6). */
  const fire = (deadline: number): void => {
    tickCancel = null;
    if (disposed || alarm.isActive()) return;
    const pending = deps.pendingSince();
    if (pending !== null && pending < deadline) {
      // Pending-press guard: never tick past a Raw_Down the arbiter still holds back.
      tickCancel = scheduler.schedule(PENDING_RETRY_MS, () => fire(deadline));
      return;
    }
    const events = engine.tick(safeTickTime(clock(), pending));
    batch(() => {
      for (const event of events) dispatch({ type: 'engine', event });
      reschedule();
    });
  };

  const applyLive = (step: LiveStep): void => {
    live = step.state;
    if (step.announce !== null) {
      announcement = { seq: (announcement?.seq ?? 0) + 1, text: step.announce };
      changed();
    }
    if (step.nextDueAt !== null && flushCancel === null) {
      flushCancel = uiScheduler.schedule(Math.max(0, step.nextDueAt - clock()), () => {
        flushCancel = null;
        if (disposed) return;
        batch(() => applyLive(flush(live, clock())));
      });
    }
  };

  const queueAnnouncement = (item: LiveItem): void => applyLive(enqueue(live, item, clock()));

  // ---- effects -------------------------------------------------------------------------------

  const speak = (sentence: string): void => {
    removeMessage('no-voice');
    removeMessage('speak-error');
    if (!speechOutput.isSupported() || speechOutput.voices().length === 0) {
      addMessage({ id: 'no-voice', text: NO_VOICE_TEXT });
      return;
    }
    const onEnd = (outcome: 'done' | 'error' | 'cancelled'): void => {
      speechEndedAt = clock();
      if (disposed || outcome !== 'error') return;
      batch(() => addMessage({ id: 'speak-error', text: SPEAK_ERROR_TEXT }));
    };
    try {
      // Voice and rate are read now, so a new selection applies to this utterance (Req 17.8).
      lastSpokenSentence = normalizedSentence(sentence);
      speechOutput.speak(sentence, { voiceURI: settings.voiceURI, rate: settings.speechRate }, onEnd);
    } catch {
      addMessage({ id: 'speak-error', text: SPEAK_ERROR_TEXT });
    }
  };

  const runEffect = (effect: SessionEffect): void => {
    switch (effect.type) {
      case 'speak':
        speak(effect.sentence);
        return;
      case 'reset-engine':
        engine.reset();
        reschedule();
        return;
      case 'alarm':
        // Synchronous and first: no Client, speech or storage call is awaited here (Req 5.3 to 5.5).
        try {
          alarm.start();
        } catch {
          // The Engine is still reset and processing continues (Req 5.5).
        }
        engine.reset();
        cancelTick();
        if (engineHeld) withholdUp = true;
        engineHeld = false;
        if (alarmActive !== alarm.isActive()) {
          alarmActive = alarm.isActive();
          changed();
        }
        return;
      case 'unknown':
        try {
          deps.unknownPattern.handle(effect.pattern);
        } catch {
          // A failing hint must not affect the session (Req 5.6).
        }
        return;
    }
  };

  // ---- dispatch ------------------------------------------------------------------------------

  const dispatch = (action: SessionAction): void => {
    const prev = session;
    const { state: next, effects } = reduce(prev, action);
    session = next;
    if (next !== prev) changed();

    // Persist Turns before the next action (Req 16.1).
    if (next.turns !== prev.turns && !storage.saveHistory(next.turns).ok) saveFailed();

    // Client rules (Req 9).
    const before = trimmedText(prev);
    const after = trimmedText(next);
    if (after !== before || next.turns !== prev.turns || action.type === 'clear-history') {
      client.update(after, contextWindow(next.turns));
    }

    for (const item of announcementsFor(prev, next, action)) queueAnnouncement(item);

    // Effects in order, each to completion before the next (Req 5.7, 8.8).
    for (const effect of effects) runEffect(effect);

    if (action.type === 'engine' && (action.event.type === 'char' || action.event.type === 'command')) {
      const char = action.event.type === 'char' ? action.event.char : action.event.command;
      for (const listener of [...charListeners]) {
        try {
          listener(char);
        } catch {
          // Ignored; other listeners and later events still run.
        }
      }
    }
  };

  // ---- Engine replacement ---------------------------------------------------------------------

  const clearPattern = (): void => {
    if (session.currentPattern === '') return;
    session = { ...session, currentPattern: '' };
    changed();
  };

  /** Req 8.9, 8.15: no later event reaches the old Engine, and a held `up` is withheld. */
  const replaceEngine = (): void => {
    cancelTick();
    engine = deps.createEngine(engineConfigOf(settings, estimates));
    if (engineHeld) withholdUp = true;
    engineHeld = false;
    clearPattern();
    reschedule();
  };

  // ---- Listen --------------------------------------------------------------------------------

  const cancelRestart = (): void => {
    const cancel = restartCancel;
    restartCancel = null;
    cancel?.();
  };

  const startRecognition = (): void => {
    if (!speechInput.start().ok) applyListen({ type: 'start-failed' });
  };

  const applyListen = (input: ListenInput): void => {
    const step = listenStep(listen, input);
    if (step.state !== listen) {
      listen = step.state;
      changed();
    }
    switch (step.command) {
      case 'start':
        cancelRestart();
        startRecognition();
        return;
      case 'stop':
        cancelRestart();
        speechInput.stop();
        return;
      case 'restart-later':
        cancelRestart();
        restartCancel = uiScheduler.schedule(LISTEN_RESTART_MS, () => {
          restartCancel = null;
          if (disposed || !listen.on) return;
          batch(startRecognition);
        });
        return;
      case null:
        return;
    }
  };

  const onFinal = (text: string): void => {
    if (disposed || !listen.on) return;
    batch(() => {
      applyListen({ type: 'final' });
      // Our own voice must not become a partner Turn (Req 18.7); blank finals are dropped (Req 18.5).
      if (speechOutput.isSpeaking() || clock() - speechEndedAt < 1_500) return;
      const trimmed = trimWhitespace(text);
      const echo = clock() - speechEndedAt < 5_000 && normalizedSentence(trimmed) === lastSpokenSentence;
      if (trimmed !== '' && !echo) dispatch({ type: 'partner-line', text: trimmed });
    });
  };

  // ---- settings ------------------------------------------------------------------------------

  /** The learned switch key belongs to the Input_Layer, which writes it through the store. */
  const withStoredKey = (record: SettingsRecord): SettingsRecord => ({
    ...record,
    switchKey: storage.settings().switchKey,
  });

  const commitSettings = (next: SettingsRecord): void => {
    settings = next;
    changed();
    // A failed write keeps the value in effect for this session (Req 20.10).
    if (!storage.saveSettings(next).ok) saveFailed();
  };

  // ---- construction --------------------------------------------------------------------------

  const loadedSettings = storage.loadSettings();
  const loadedHistory = storage.loadHistory();
  settings = loadedSettings.record;
  if (deps.persistent === false || loadedSettings.error !== null || loadedHistory.error !== null) saveFailed();
  engine = deps.createEngine(engineConfigOf(settings, null));
  const client = deps.createClient((result) => {
    if (disposed) return;
    batch(() => dispatch({ type: 'suggestions', result }));
  });
  // Hydrate before any press can arrive (Req 16.5).
  dispatch({ type: 'hydrate', turns: loadedHistory.record.turns });

  unsubscribers.push(
    speechInput.onInterim((text) => {
      if (!disposed) batch(() => applyListen({ type: 'interim', text }));
    }),
    speechInput.onFinal(onFinal),
    speechInput.onError((error) => {
      if (!disposed) batch(() => applyListen({ type: 'error', error }));
    }),
    speechInput.onEnd(() => {
      if (!disposed) batch(() => applyListen({ type: 'end' }));
    }),
    speechOutput.onVoicesChanged((list) => {
      if (disposed) return;
      batch(() => {
        voices = list;
        changed();
      });
    }),
    alarm.onActiveChange((active) => {
      if (disposed) return;
      batch(() => {
        if (alarmActive !== active) {
          alarmActive = active;
          changed();
        }
        // The Engine was reset at alarm start, so this normally schedules nothing.
        if (!active) reschedule();
      });
    }),
  );
  dirty = false;

  // ---- public API ----------------------------------------------------------------------------

  return {
    handlePress(event) {
      if (disposed) return;
      batch(() => {
        const down = event.kind === 'down';
        if (pressed !== down) {
          pressed = down;
          changed();
        }
        // A withheld `up` that a Press_Router dropped must not swallow a later one (onboarding O12.8).
        if (down) withholdUp = false;
        if (!down && withholdUp) {
          withholdUp = false;
          return;
        }
        if (alarm.isActive()) {
          try {
            alarm.handlePress(event);
          } catch {
            // The alarm owns its own failures.
          }
          return;
        }
        const t = event.source === 'blink' ? Math.max(event.t, engine.snapshot().lastT ?? event.t) : event.t;
        const events = down ? engine.press(t) : engine.release(t);
        engineHeld = down;
        for (const engineEvent of events) dispatch({ type: 'engine', event: engineEvent });
        if (!alarm.isActive()) reschedule();
      });
    },

    partnerPick(index) {
      if (disposed) return;
      batch(() => dispatch({ type: 'partner-pick', index }));
    },

    partnerLine(text) {
      if (disposed) return;
      const trimmed = trimWhitespace(text);
      if (trimmed === '') return;
      batch(() => dispatch({ type: 'partner-line', text: trimmed }));
    },

    clearHistory() {
      if (disposed) return;
      batch(() => {
        const before = session.turns;
        dispatch({ type: 'clear-history' });
        // dispatch saved when Turns changed; an already empty history is still written (Req 16.2).
        if (session.turns === before && !storage.saveHistory([]).ok) saveFailed();
      });
    },

    updateSettings(patch) {
      const result = validateSettingsPatch(settings, patch);
      if (!result.ok || disposed) return result;
      const next = withStoredKey(result.value);
      const speedChanged = next.startingWpm !== settings.startingWpm;
      const engineChanged = speedChanged || next.adaptive !== settings.adaptive;
      const anyChange =
        engineChanged ||
        next.voiceURI !== settings.voiceURI ||
        next.speechRate !== settings.speechRate ||
        next.flip !== settings.flip ||
        next.switchKey !== settings.switchKey;
      if (!anyChange) return ok(settings);
      batch(() => {
        if (speedChanged) {
          estimates = null;
          if (deps.clearCalibration?.() === false) saveFailed();
        }
        commitSettings(next);
        if (engineChanged) replaceEngine();
      });
      return ok(next);
    },

    updateInputSettings(input) {
      if (disposed) return;
      const parsed = InputSettingsSchema.safeParse(input);
      const valid = parsed.success ? parsed.data : settings.input;
      if (JSON.stringify(valid) === JSON.stringify(settings.input)) return;
      batch(() => commitSettings(withStoredKey({ ...settings, input: valid })));
    },

    setInitialEstimates(next) {
      if (disposed) return;
      estimates = next;
      batch(replaceEngine);
    },

    getEstimates() {
      const { dotEstimate, dashEstimate } = engine.estimates();
      return { dotEstimate, dashEstimate };
    },

    setListen(on) {
      if (disposed) return;
      batch(() => applyListen({ type: 'toggle', on }));
    },

    setSourceStatuses(statuses) {
      if (disposed) return;
      batch(() => {
        for (const kind of SOURCE_KINDS) {
          const status = statuses[kind];
          if (isQuiet(status)) removeMessage(`source-${kind}`);
          else addMessage({ id: `source-${kind}`, text: sourceStatusText(kind, status) });
        }
      });
    },

    dismissMessage(id) {
      if (disposed) return;
      batch(() => removeMessage(id));
    },

    discardInput() {
      if (disposed) return;
      batch(() => {
        cancelTick();
        // Same Engine, so the learned estimates stay (onboarding O12.2); buffered symbols are dropped.
        engine.reset();
        if (engineHeld) withholdUp = true;
        engineHeld = false;
        clearPattern();
        reschedule();
      });
    },

    onCodeCommitted(listener) {
      if (disposed) return () => undefined;
      charListeners.add(listener);
      return () => {
        charListeners.delete(listener);
      };
    },

    getSnapshot() {
      snapshot ??= { session, settings, pressed, alarmActive, listen, voices, announcement, messages };
      return snapshot;
    },

    subscribe(listener) {
      subscribers.add(listener);
      return () => {
        subscribers.delete(listener);
      };
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      cancelTick();
      const cancelFlush = flushCancel;
      flushCancel = null;
      cancelFlush?.();
      cancelRestart();
      try {
        client.dispose();
      } catch {
        // ignore
      }
      for (const unsubscribe of unsubscribers.splice(0)) unsubscribe();
      speechInput.stop();
      charListeners.clear();
      subscribers.clear();
    },
  };
}

/** Wraps a Result-returning Engine factory: a failed configuration falls back to the defaults (Req 8.9). */
export function engineOrDefault(
  create: (config?: EngineConfig) => Result<Engine, unknown>,
): (config: EngineConfig) => Engine {
  return (config) => {
    const built = create(config);
    if (built.ok) return built.value;
    const fallback = create();
    if (fallback.ok) return fallback.value;
    throw new Error('the default Engine configuration was rejected');
  };
}
