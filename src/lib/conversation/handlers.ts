/**
 * Plug-in interfaces that onboarding-and-safety implements, with defaults that keep today's
 * behaviour when nothing is plugged in (design "lib/conversation/handlers.ts" and
 * "Integration points for onboarding-and-safety").
 */
import {
  err,
  type LearnError,
  type PressEvent,
  type Result,
  type SourceKind,
  type SourceStatus,
  type SwitchLearner,
  type Unsubscribe,
} from '@/lib/input';

/** Implemented by onboarding-and-safety. All methods synchronous. */
export interface AlarmHandler {
  /** Starts the SOS alarm (card and chime). Called synchronously from the effect runner; may throw. */
  start(): void;
  /** True from start() until the alarm is dismissed. */
  isActive(): boolean;
  /** Receives every Press_Event while isActive() is true (Req 8.10). */
  handlePress(event: PressEvent): void;
  /** Fires when isActive() changes, so the controller can resume Engine scheduling. */
  onActiveChange(listener: (active: boolean) => void): Unsubscribe;
}

/** Implemented by onboarding-and-safety (for example a brief "not a code" hint). */
export interface UnknownPatternHandler {
  handle(pattern: string): void;
}

const NO_UNSUBSCRIBE: Unsubscribe = () => undefined;

/** Never active; start() does nothing. Used until onboarding-and-safety supplies the alarm. */
export function inertAlarmHandler(): AlarmHandler {
  return {
    start: () => undefined,
    isActive: () => false,
    handlePress: () => undefined,
    onActiveChange: () => NO_UNSUBSCRIBE,
  };
}

/** Ignores every pattern. Used until onboarding-and-safety supplies the handler. */
export function inertUnknownPatternHandler(): UnknownPatternHandler {
  return { handle: () => undefined };
}

// ---- Integration points for onboarding-and-safety (additive) ----

/** What DitApp hands to a Press_Router: the session's press entry point and its discard hook. */
export interface SessionPressTarget {
  /** SessionController.handlePress, unchanged. */
  handlePress(event: PressEvent): void;
  /** SessionController.discardInput: empty the Pattern_Buffer, forget an unmatched down, cancel the Tick_Timer. */
  discardInput(): void;
}

/** Sits between the Input_Arbiter Output_Stream and the Session_Controller (onboarding O12.1). */
export interface PressRouter {
  /** Called once by DitApp after the controller exists; the returned function disconnects (unmount). */
  connect(session: SessionPressTarget): Unsubscribe;
  /** Receives every Press_Event from the Output_Stream, in order, synchronously. Delivers it to at most one consumer. */
  route(event: PressEvent): void;
}

/** Default when DitApp gets no pressRouter: every event goes to session.handlePress, as without a router. */
export function sessionOnlyRouter(): PressRouter {
  let target: SessionPressTarget | null = null;
  return {
    connect(session) {
      target = session;
      return () => {
        if (target === session) target = null;
      };
    },
    route(event) {
      target?.handlePress(event);
    },
  };
}

/** Enabled flags passed to useInputSources. Blink starts only from a user action (input-sources Req 9.1). */
export type EnabledSources = Readonly<Record<SourceKind, boolean>>;

export const DEFAULT_ENABLED_SOURCES: EnabledSources = Object.freeze({
  keyboard: true,
  switch: true,
  pointer: true,
  blink: false,
});

/** Runtime control over Press_Sources, provided by DitApp through SessionApiContext. */
export interface SourceControl {
  enabled(): EnabledSources;
  /** useInputSources().statuses */
  statuses(): Readonly<Record<SourceKind, SourceStatus>>;
  /** Keyboard, switch or pointer on or off. */
  setEnabled(kind: Exclude<SourceKind, 'blink'>, on: boolean): void;
  /** Call only synchronously from a click, keydown or pointerdown handler. Starts, or retries from a failure status. */
  startBlink(): void;
  stopBlink(): void;
  /** Replaces all four flags at once (used to restore a snapshot on "Cancel setup"). */
  restore(flags: EnabledSources): void;
  /** Fires after the enabled flags or the statuses change. */
  onChange(listener: () => void): Unsubscribe;
}

const NOT_AVAILABLE = 'not available';

/** Learner for the no-op SessionApiContext: never arms; arm() and clear() fail with "not available". */
export function unavailableLearner(): SwitchLearner {
  return {
    arm: (): Promise<Result<string, LearnError>> =>
      Promise.resolve(err({ reason: 'cancelled', message: NOT_AVAILABLE })),
    cancel: () => undefined,
    isArmed: () => false,
    snapshot: () => ({ active: null, stored: null }),
    restore: () => err({ reason: 'save-failed', message: NOT_AVAILABLE }),
    clear: () => err({ reason: 'save-failed', message: NOT_AVAILABLE }),
  };
}
