/**
 * The Onboarding controller (design "lib/onboarding/controller.ts", Requirements 11 to 16): runs
 * the Onboarding_Reducer and its effects, owns the Guard_Engine that watches practice presses for
 * SOS, reads and writes the Onboarding_Record, and offers the view the components render.
 * Framework-free: storage, clock, scheduler, Engine factory, alarm, router and the session API
 * are injected, and nothing here reads a browser global.
 */
import { engineConfigOf, type EnabledSources, type KeyValueBackend, type SettingsRecord, type SourceControl } from '@/lib/conversation';
import {
  err,
  isFailureStatus,
  safeTickTime,
  type Clock,
  type LearnError,
  type PressEvent,
  type Result,
  type Scheduler,
  type SourceStatus,
  type SwitchLearner,
  type Unsubscribe,
} from '@/lib/input';
import type { Engine, EngineConfig, EngineEvent, Estimates } from '@/lib/morse';
import { initialFirstRun, initialRerun, isOpenStep, onboardingEffects, onboardingStep } from './flow';
import { readOnboardingRecord, writeOnboardingRecord } from './record';
import { BLINK_FAILURE_TEXT, SWITCH_UNAVAILABLE_TEXT } from './strings';
import type { InputChoice, OnboardingAction, OnboardingEffect, OnboardingState } from './types';

/** Retry delay while a Pending_Press is older than the Guard_Engine deadline (same rule as the session). */
export const GUARD_PENDING_RETRY_MS = 50;

/** Built by OnboardingHost from SessionApiContext. */
export interface OnboardingSessionApi {
  /** SessionController.setInitialEstimates: the only way estimates reach the Session_Engine (15.9). */
  setInitialEstimates(e: Estimates | null): void;
  /** Focuses the Keying_Surface on the next animation frame. */
  focusKeyingSurface(): void;
  /** Focuses the selected Input_Step tile on the next animation frame ("Run setup again", 11.7). */
  focusSelectedChoice(): void;
  /** controller.getSnapshot().settings */
  settings(): SettingsRecord;
  readonly sources: SourceControl;
  /** SessionApiContext.learner, or null when the session offers none. */
  readonly learner: SwitchLearner | null;
  /** The arbiter's earliest pending Raw_Down, read at timer time. */
  pendingSince(): number | null;
}

export interface BlinkResume {
  /** "Turn on camera for blink input" is shown (Requirements 11.12 to 11.14). */
  readonly visible: boolean;
  /** Plain-words reason for a failure status, or null. */
  readonly reason: string | null;
}

export interface OnboardingView {
  /** null while the flow is closed. */
  readonly state: OnboardingState | null;
  /** The "Setup could not be saved…" note (Requirement 16.6), until a later save succeeds. */
  readonly saveFailed: boolean;
  readonly inputChoiceInEffect: InputChoice | null;
  readonly blinkResume: BlinkResume;
}

export interface OnboardingController {
  /** Reads the record once per page load and opens the flow or applies the stored estimates; returns detach. */
  attach(api: OnboardingSessionApi): Unsubscribe;
  isOpen(): boolean;
  /** The Press_Router's onboarding consumer. */
  handlePress(e: PressEvent): void;
  /** UI actions. Effects run synchronously, so startBlink() runs inside the user's click (13.8). */
  dispatch(a: OnboardingAction): void;
  runSetupAgain(): void;
  /** "Turn on camera for blink input" (Requirement 11.13); call it from the click handler. */
  turnOnBlinkCamera(): void;
  /** The same object until something changes. */
  getView(): OnboardingView;
  subscribe(listener: () => void): Unsubscribe;
}

export interface OnboardingControllerDeps {
  /** Read lazily, so DitRoot can pass () => localStorageBackend() before any browser adapter is attached. */
  readonly backend: () => KeyValueBackend | null;
  readonly clock: () => Clock | null;
  readonly scheduler: () => Scheduler | null;
  /** Wraps the morse createEngine and falls back to the defaults for a bad configuration. */
  readonly createEngine: (c: EngineConfig) => Engine;
  readonly alarm: { start(): void };
  readonly router: { onOnboardingOpenChange(): void };
}

const HIDDEN: BlinkResume = Object.freeze({ visible: false, reason: null });
const SHOWN: BlinkResume = Object.freeze({ visible: true, reason: null });
const FOCUS_SELECTED: OnboardingEffect = Object.freeze({ type: 'focus-selected-choice' });

const isSos = (event: EngineEvent): boolean => event.type === 'command' && event.command === 'sos';

function attempt<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function createOnboardingController(deps: OnboardingControllerDeps): OnboardingController {
  let api: OnboardingSessionApi | null = null;
  /** The load decision is made once per page load, even if the host attaches again (strict mode). */
  let decided = false;
  let state: OnboardingState | null = null;
  let guard: Engine | null = null;
  let guardCancel: (() => void) | null = null;
  /** Enabled flags when the flow opened, restored by "Cancel setup" (11.9). */
  let sourceSnapshot: EnabledSources | null = null;
  let inputChoiceInEffect: InputChoice | null = null;
  let estimatesInEffect: Estimates | null = null;
  let saveFailed = false;
  /** Drops a learner result whose arm() was cancelled or replaced. */
  let learnAttempt = 0;
  let unsubscribeSources: Unsubscribe | null = null;
  const subscribers = new Set<() => void>();

  const isOpen = (): boolean => state !== null && isOpenStep(state.step);

  const blinkStatus = (): SourceStatus => {
    const current = api;
    return current === null ? 'off' : attempt(() => current.sources.statuses().blink, 'off');
  };

  const blinkResumeOf = (): BlinkResume => {
    // While the flow is open, its Input_Step handles the camera itself.
    if (inputChoiceInEffect !== 'blink' || isOpen()) return HIDDEN;
    const status = blinkStatus();
    if (status === 'off') return SHOWN;
    if (!isFailureStatus(status)) return HIDDEN; // starting, active, face-lost (11.13)
    return { visible: status !== 'unsupported', reason: BLINK_FAILURE_TEXT[status] }; // 11.14
  };

  let view: OnboardingView = { state, saveFailed, inputChoiceInEffect, blinkResume: HIDDEN };

  /** Recomputes the view and notifies subscribers once when anything in it changed. */
  const publish = (): void => {
    const blinkResume = blinkResumeOf();
    const same =
      view.state === state &&
      view.saveFailed === saveFailed &&
      view.inputChoiceInEffect === inputChoiceInEffect &&
      view.blinkResume.visible === blinkResume.visible &&
      view.blinkResume.reason === blinkResume.reason;
    if (same) return;
    view = { state, saveFailed, inputChoiceInEffect, blinkResume };
    for (const listener of [...subscribers]) {
      try {
        listener();
      } catch {
        // One subscriber must not break the others.
      }
    }
  };

  const tellRouter = (): void => {
    try {
      deps.router.onOnboardingOpenChange();
    } catch {
      // The router keeps routing; a failed discard must not block the flow.
    }
  };

  // ---- Guard_Engine (Requirements 12.3 to 12.7, 12.9) ----

  const cancelGuardTimer = (): void => {
    guardCancel?.();
    guardCancel = null;
  };

  /** 12.5: the configuration the session would build from the current settings and the stored estimates. */
  const guardConfigNow = (): EngineConfig => {
    const current = api;
    const settings = current === null ? null : attempt(() => current.settings(), null);
    if (settings !== null) return engineConfigOf(settings, estimatesInEffect);
    return estimatesInEffect === null
      ? {}
      : { initialDotEstimate: estimatesInEffect.dotEstimate, initialDashEstimate: estimatesInEffect.dashEstimate };
  };

  /** The configuration the Guard_Engine was built with, while it has seen no press yet. */
  let unusedGuardConfig: EngineConfig | null = null;

  const buildGuard = (): Engine | null => {
    const config = guardConfigNow();
    unusedGuardConfig = config;
    return attempt(() => deps.createEngine(config), null) ?? attempt(() => deps.createEngine({}), null);
  };

  /**
   * On first load the flow opens before the session has read the stored settings, so the first
   * press rebuilds a Guard_Engine that has seen no input if the configuration has changed since.
   */
  const guardForPress = (): Engine | null => {
    const built = unusedGuardConfig;
    if (built !== null) {
      unusedGuardConfig = null;
      const now = guardConfigNow();
      const same =
        now.startingWpm === built.startingWpm &&
        now.mode === built.mode &&
        now.initialDotEstimate === built.initialDotEstimate &&
        now.initialDashEstimate === built.initialDashEstimate;
      if (!same) {
        guard = buildGuard();
        unusedGuardConfig = null;
      }
    }
    return guard;
  };

  /** SOS during onboarding: the alarm starts at once; the flow keeps its step and presses (12.6, 2.11). */
  const raiseAlarm = (): void => {
    cancelGuardTimer();
    try {
      deps.alarm.start();
    } catch {
      // The Alarm_Handler catches its own failures; this only protects the flow.
    }
    // The alarm takes every press until it ends, so forget a half-made pattern or press.
    const g = guard;
    if (g !== null) attempt(() => g.reset(), undefined);
  };

  const rescheduleGuard = (): void => {
    cancelGuardTimer();
    const g = guard;
    const scheduler = deps.scheduler();
    const clock = deps.clock();
    if (g === null || scheduler === null || clock === null || api === null || !isOpen()) return;
    const deadline = attempt(() => g.nextDeadline(), null);
    if (deadline === null || !Number.isFinite(deadline)) return;
    guardCancel = scheduler.schedule(Math.max(0, deadline - clock()), () => fireGuard(deadline));
  };

  const fireGuard = (deadline: number): void => {
    guardCancel = null;
    const g = guard;
    const clock = deps.clock();
    const current = api;
    if (g === null || clock === null || current === null || !isOpen()) return;
    const pending = attempt(() => current.pendingSince(), null);
    if (pending !== null && pending < deadline) {
      // Never tick past a Raw_Down the arbiter still holds back.
      const scheduler = deps.scheduler();
      if (scheduler !== null) guardCancel = scheduler.schedule(GUARD_PENDING_RETRY_MS, () => fireGuard(deadline));
      return;
    }
    const events = attempt(() => g.tick(safeTickTime(clock(), pending)), []);
    if (events.some(isSos)) {
      raiseAlarm();
      return;
    }
    rescheduleGuard(); // other Engine_Events are discarded (12.7)
  };

  // ---- Opening and closing ----

  const open = (initial: OnboardingState): void => {
    const current = api;
    sourceSnapshot = current === null ? null : attempt(() => current.sources.enabled(), null);
    guard = buildGuard();
    state = initial;
    tellRouter(); // 12.10: the session discards its buffered input
    publish();
  };

  const close = (): void => {
    cancelGuardTimer();
    guard = null; // 12.9: no Guard_Engine tick or event after the close
    unusedGuardConfig = null;
    state = null;
    sourceSnapshot = null;
    learnAttempt += 1;
    tellRouter();
    publish();
  };

  // ---- Effects ----

  const armLearner = (): void => {
    learnAttempt += 1;
    const token = learnAttempt;
    const learner = api?.learner ?? null;
    const unavailable: Result<string, LearnError> = err({ reason: 'cancelled', message: SWITCH_UNAVAILABLE_TEXT });
    const pending: Promise<Result<string, LearnError>> =
      learner === null ? Promise.resolve(unavailable) : attempt(() => learner.arm(), Promise.resolve(unavailable));
    const deliver = (result: Result<string, LearnError>): void => {
      if (token !== learnAttempt) return; // cancelled or replaced
      controller.dispatch({
        type: 'switch-result',
        result: result.ok ? { ok: true, code: result.value } : { ok: false, message: result.error.message },
      });
    };
    pending.then(deliver, () => deliver(unavailable));
  };

  const runEffect = (effect: OnboardingEffect): void => {
    const current = api;
    switch (effect.type) {
      case 'arm-learner':
        armLearner();
        return;
      case 'disarm-learner':
        learnAttempt += 1;
        attempt(() => current?.learner?.cancel(), undefined);
        return;
      case 'start-blink':
        attempt(() => current?.sources.startBlink(), undefined);
        return;
      case 'stop-blink':
        attempt(() => current?.sources.stopBlink(), undefined);
        return;
      case 'apply-estimates':
        estimatesInEffect = effect.estimates;
        attempt(() => current?.setInitialEstimates(effect.estimates), undefined);
        return;
      case 'focus-keying-surface':
        attempt(() => current?.focusKeyingSurface(), undefined);
        return;
      case 'focus-selected-choice':
        attempt(() => current?.focusSelectedChoice(), undefined);
        return;
      case 'finish': {
        const written = writeOnboardingRecord(attempt(deps.backend, null), {
          v: 1,
          complete: true,
          inputChoice: effect.report.inputChoice,
          estimates: effect.report.estimates,
        });
        // 16.6: the choice and estimates stay in effect for this page load either way.
        saveFailed = !written.ok;
        inputChoiceInEffect = effect.report.inputChoice;
        close();
        return;
      }
      case 'cancel': {
        const snapshot = sourceSnapshot;
        if (snapshot !== null) attempt(() => current?.sources.restore(snapshot), undefined);
        close();
        return;
      }
    }
  };

  const onSourcesChange = (): void => {
    const s = state;
    if (s !== null && s.step === 'input' && s.selected === 'blink') {
      controller.dispatch({ type: 'blink-status', status: blinkStatus() });
    }
    publish(); // the blink resume button follows the status
  };

  const controller: OnboardingController = {
    attach(next) {
      api = next;
      unsubscribeSources?.();
      unsubscribeSources = attempt(() => next.sources.onChange(onSourcesChange), null);
      if (!decided) {
        decided = true;
        const outcome = readOnboardingRecord(attempt(deps.backend, null));
        if (outcome.kind === 'valid' && outcome.record.complete) {
          // 11.3, 11.4: closed, and the stored estimates applied exactly once.
          inputChoiceInEffect = outcome.record.inputChoice;
          estimatesInEffect = outcome.record.estimates;
          attempt(() => next.setInitialEstimates(outcome.record.estimates), undefined);
        } else {
          // 11.2 (missing, invalid or incomplete) and 11.5 (read error): open, estimates untouched.
          open(initialFirstRun());
        }
      } else {
        rescheduleGuard();
      }
      publish();
      return () => {
        if (api !== next) return;
        api = null;
        unsubscribeSources?.();
        unsubscribeSources = null;
        cancelGuardTimer();
      };
    },

    isOpen,

    handlePress(e) {
      if (!isOpen()) return;
      // 12.3: the Guard_Engine sees the press before the current step does.
      const g = guardForPress();
      const events = g === null ? [] : attempt(() => (e.kind === 'down' ? g.press(e.t) : g.release(e.t)), []);
      if (events.some(isSos)) {
        // 7.6: synchronously, before the next press is routed. The press itself is the start of
        // the alarm, so the flow keeps its state as it was (2.11, 12.6).
        raiseAlarm();
        return;
      }
      controller.dispatch({ type: 'press', kind: e.kind, t: e.t });
      rescheduleGuard();
    },

    dispatch(a) {
      const prev = state;
      if (prev === null) return;
      const next = onboardingStep(prev, a);
      if (next === prev) return;
      state = next;
      for (const effect of onboardingEffects(prev, next, a)) runEffect(effect);
      publish();
    },

    runSetupAgain() {
      if (state !== null) return;
      // 11.7, 11.10: the choice in effect is selected, and nothing is written until Start.
      open(initialRerun(inputChoiceInEffect ?? 'key-tap', blinkStatus()));
      runEffect(FOCUS_SELECTED);
    },

    turnOnBlinkCamera() {
      const current = api;
      attempt(() => current?.sources.startBlink(), undefined);
      publish();
    },

    getView: () => view,

    subscribe(listener) {
      const wrapped = (): void => listener();
      subscribers.add(wrapped);
      return () => {
        subscribers.delete(wrapped);
      };
    },
  };
  return controller;
}
