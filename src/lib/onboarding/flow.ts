/**
 * The Onboarding_Reducer (design "lib/onboarding/flow.ts", Requirement 17): a pure state function
 * plus a pure function that derives each transition's side effects. An action that is not valid
 * in the current step returns the same state object, and then no effects.
 */
import type { SourceStatus } from '@/lib/input';
import { calibrate, type Calibration } from '@/lib/morse';
import { PRESS_LONG, PRESS_SHORT, practiceCountText } from './strings';
import type {
  BlinkPhase,
  InputChoice,
  OnboardingAction,
  OnboardingEffect,
  OnboardingState,
  Origin,
  PracticeResult,
  Step,
  SwitchPhase,
} from './types';

/** Practice_Presses per Practice_Step: 3 short, then 2 long (Requirement 14). */
export const PRACTICE_PRESSES = 5;

const freeze = <T extends object>(value: T): T => Object.freeze(value);

const SWITCH_IDLE: SwitchPhase = freeze({ kind: 'idle' });
const SWITCH_ARMED: SwitchPhase = freeze({ kind: 'armed' });
const BLINK_IDLE: BlinkPhase = freeze({ kind: 'idle' });
const BLINK_EXPLAINED: BlinkPhase = freeze({ kind: 'explained' });
const BLINK_STARTING: BlinkPhase = freeze({ kind: 'started', status: 'starting' });
const NO_RESULT: PracticeResult = freeze({ kind: 'none' });
const DEFAULT_SPEED: PracticeResult = freeze({ kind: 'default', calibration: null });
const NO_DURATIONS: readonly number[] = freeze([]);

const NO_EFFECTS: readonly OnboardingEffect[] = freeze([]);
const ARM: OnboardingEffect = freeze({ type: 'arm-learner' });
const DISARM: OnboardingEffect = freeze({ type: 'disarm-learner' });
const START_BLINK: OnboardingEffect = freeze({ type: 'start-blink' });
const STOP_BLINK: OnboardingEffect = freeze({ type: 'stop-blink' });
const FOCUS_SURFACE: OnboardingEffect = freeze({ type: 'focus-keying-surface' });
const CANCEL: OnboardingEffect = freeze({ type: 'cancel' });

/** Blink statuses that confirm the Blink choice (Requirement 13.9). */
const confirmsBlink = (status: SourceStatus): boolean => status === 'active' || status === 'face-lost';
/** Failure statuses that offer "Try again" (Requirement 13.10). */
const canRetryCamera = (status: SourceStatus): boolean =>
  status === 'permission-denied' || status === 'no-camera' || status === 'error';

function initial(origin: Origin): OnboardingState {
  return {
    step: 'input',
    origin,
    selected: null,
    inputChoice: null,
    switchPhase: SWITCH_IDLE,
    blinkPhase: BLINK_IDLE,
    durations: NO_DURATIONS,
    heldDownT: null,
    result: NO_RESULT,
    applied: 'unset',
    report: null,
  };
}

/** The Input_Step with nothing selected, Continue disabled and no camera or learner (Requirement 13.2). */
export function initialFirstRun(): OnboardingState {
  return initial('first-run');
}

/**
 * "Run setup again" (Requirements 11.7, 13.9): the previous choice is selected. Key or tap and
 * Switch stay confirmed; Blink is confirmed only while the Blink_Source is active or face-lost.
 */
export function initialRerun(previous: InputChoice, blinkStatus: SourceStatus): OnboardingState {
  const base = initial('rerun');
  if (previous !== 'blink') return { ...base, selected: previous, inputChoice: previous };
  if (blinkStatus === 'off') return { ...base, selected: 'blink', blinkPhase: BLINK_EXPLAINED };
  return {
    ...base,
    selected: 'blink',
    blinkPhase: { kind: 'started', status: blinkStatus },
    inputChoice: confirmsBlink(blinkStatus) ? 'blink' : null,
  };
}

/** input, practice and legend; done and cancelled are terminal. */
export function isOpenStep(step: Step): boolean {
  return step === 'input' || step === 'practice' || step === 'legend';
}

const heldCalibration = (result: PracticeResult): Calibration | null =>
  result.kind === 'none' ? null : result.calibration;

function practiceCleared(s: OnboardingState, step: Step = s.step): OnboardingState {
  return { ...s, step, durations: NO_DURATIONS, heldDownT: null, result: NO_RESULT };
}

/** "Key or tap" and "Use key or tap instead" (Requirements 13.3, 13.11). Not a React hook. */
function chooseKeyTap(s: OnboardingState): OnboardingState {
  if (
    s.selected === 'key-tap' &&
    s.inputChoice === 'key-tap' &&
    s.switchPhase.kind === 'idle' &&
    s.blinkPhase.kind === 'idle'
  ) {
    return s;
  }
  return { ...s, selected: 'key-tap', inputChoice: 'key-tap', switchPhase: SWITCH_IDLE, blinkPhase: BLINK_IDLE };
}

function choose(s: OnboardingState, choice: InputChoice): OnboardingState {
  if (choice === 'key-tap') return chooseKeyTap(s);
  if (choice === 'switch') {
    // Arms (or re-arms) the Switch_Learner; only its result can confirm the choice (13.4).
    return { ...s, selected: 'switch', inputChoice: null, switchPhase: SWITCH_ARMED, blinkPhase: BLINK_IDLE };
  }
  // Blink already chosen: keep the camera explanation or the running camera as it is.
  if (s.selected === 'blink') return s;
  return { ...s, selected: 'blink', inputChoice: null, switchPhase: SWITCH_IDLE, blinkPhase: BLINK_EXPLAINED };
}

function inputStep(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'choose':
      return choose(s, a.choice);
    case 'use-key-tap':
      return chooseKeyTap(s);
    case 'switch-result':
      if (s.switchPhase.kind !== 'armed') return s;
      return a.result.ok
        ? { ...s, inputChoice: 'switch', switchPhase: { kind: 'learned', code: a.result.code } }
        : { ...s, inputChoice: null, switchPhase: { kind: 'failed', message: a.result.message } };
    case 'switch-retry':
      return s.switchPhase.kind === 'failed' ? { ...s, switchPhase: SWITCH_ARMED } : s;
    case 'camera-on': {
      if (s.selected !== 'blink') return s;
      const phase = s.blinkPhase;
      const allowed = phase.kind === 'explained' || (phase.kind === 'started' && canRetryCamera(phase.status));
      return allowed ? { ...s, inputChoice: null, blinkPhase: BLINK_STARTING } : s;
    }
    case 'blink-status': {
      if (s.selected !== 'blink' || s.blinkPhase.kind !== 'started' || s.blinkPhase.status === a.status) return s;
      return { ...s, blinkPhase: { kind: 'started', status: a.status }, inputChoice: confirmsBlink(a.status) ? 'blink' : null };
    }
    case 'continue':
      return s.inputChoice === null ? s : practiceCleared(s, 'practice');
    case 'cancel':
      return s.origin === 'rerun' ? { ...s, step: 'cancelled' } : s;
    default:
      return s;
  }
}

function practiceStep(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'press': {
      if (a.kind === 'down') {
        return s.heldDownT === null && s.durations.length < PRACTICE_PRESSES ? { ...s, heldDownT: a.t } : s;
      }
      if (s.heldDownT === null) return s; // 14.8: an up without a down from this Practice_Step
      const durations = [...s.durations, a.t - s.heldDownT];
      if (durations.length < PRACTICE_PRESSES) return { ...s, durations, heldDownT: null };
      // 15.1: calibrate() exactly once, on the fifth duration; the newest outcome wins (15.4).
      const calibration = calibrate(durations);
      const result: PracticeResult =
        calibration.reason === null ? { kind: 'measured', calibration } : { kind: 'default', calibration };
      return { ...s, durations, heldDownT: null, result };
    }
    case 'use-default':
      // 14.11, 14.12: the default estimates, no Calibration held, and no duration added.
      return s.result.kind === 'default' && s.result.calibration === null ? s : { ...s, result: DEFAULT_SPEED };
    case 'practice-again':
      return heldCalibration(s.result) === null ? s : practiceCleared(s);
    case 'use-this-speed': {
      if (s.result.kind !== 'measured') return s;
      const { dotEstimate, dashEstimate } = s.result.calibration;
      return { ...s, step: 'legend', applied: { dotEstimate, dashEstimate } };
    }
    case 'continue':
      return s.result.kind === 'default' ? { ...s, step: 'legend', applied: null } : s;
    case 'cancel':
      return s.origin === 'rerun' ? { ...s, step: 'cancelled' } : s;
    default:
      return s;
  }
}

function legendStep(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (a.type) {
    case 'start':
      if (s.inputChoice === null || s.applied === 'unset') return s;
      return { ...s, step: 'done', report: { complete: true, inputChoice: s.inputChoice, estimates: s.applied } };
    case 'cancel':
      return s.origin === 'rerun' ? { ...s, step: 'cancelled' } : s;
    default:
      return s;
  }
}

/** Pure; never throws; returns the same object for an action that is not valid in the current step. */
export function onboardingStep(s: OnboardingState, a: OnboardingAction): OnboardingState {
  switch (s.step) {
    case 'input':
      return inputStep(s, a);
    case 'practice':
      return practiceStep(s, a);
    case 'legend':
      return legendStep(s, a);
    default:
      return s; // done and cancelled accept nothing (16.7, 17.8)
  }
}

/** The camera was asked to run and has not been stopped (Requirements 13.3, 13.4). */
const blinkRunning = (s: OnboardingState): boolean => s.blinkPhase.kind === 'started' && s.blinkPhase.status !== 'off';

/** Pure: the side effects of the transition prev → next by `a`, in order. Empty when next === prev. */
export function onboardingEffects(
  prev: OnboardingState,
  next: OnboardingState,
  a: OnboardingAction,
): readonly OnboardingEffect[] {
  if (next === prev) return NO_EFFECTS;
  switch (a.type) {
    case 'choose':
    case 'use-key-tap': {
      const choice: InputChoice = a.type === 'choose' ? a.choice : 'key-tap';
      const effects: OnboardingEffect[] = [];
      if (choice !== 'switch' && prev.switchPhase.kind === 'armed') effects.push(DISARM);
      if (choice !== 'blink' && blinkRunning(prev)) effects.push(STOP_BLINK);
      if (choice === 'switch') effects.push(ARM);
      return effects;
    }
    case 'switch-retry':
      return [ARM];
    case 'camera-on':
      return [START_BLINK];
    case 'continue':
      if (prev.step === 'input') return [FOCUS_SURFACE];
      return next.applied === 'unset' ? NO_EFFECTS : [{ type: 'apply-estimates', estimates: next.applied }];
    case 'practice-again':
      return [FOCUS_SURFACE];
    case 'use-this-speed':
      return next.applied === 'unset' ? NO_EFFECTS : [{ type: 'apply-estimates', estimates: next.applied }];
    case 'start':
      return next.report === null ? NO_EFFECTS : [{ type: 'finish', report: next.report }, FOCUS_SURFACE];
    case 'cancel':
      return [DISARM, CANCEL, FOCUS_SURFACE];
    default:
      return NO_EFFECTS;
  }
}

/** Continue is enabled on the Input_Step with a confirmed choice, and on the Practice_Step with a default result. */
export function continueEnabled(s: OnboardingState): boolean {
  if (s.step === 'input') return s.inputChoice !== null;
  if (s.step === 'practice') return s.result.kind === 'default';
  return false;
}

/** "Holding…" next to the practice row while a press is down and fewer than 5 are collected (14.7). */
export function heldIndicatorShown(s: OnboardingState): boolean {
  return s.step === 'practice' && s.heldDownT !== null && s.durations.length < PRACTICE_PRESSES;
}

/**
 * The prompt and count for n collected presses: "Press short" for n < 3, else "Press long", and
 * "Press n+1 of 5". null outside the Practice_Step and once 5 are collected (14.1, 14.5, 14.6).
 */
export function practicePrompt(
  s: OnboardingState,
): { readonly prompt: typeof PRESS_SHORT | typeof PRESS_LONG; readonly count: string } | null {
  if (s.step !== 'practice') return null;
  const n = s.durations.length;
  if (n >= PRACTICE_PRESSES) return null;
  return { prompt: n < 3 ? PRESS_SHORT : PRESS_LONG, count: practiceCountText(Math.min(n, 4) + 1) };
}

/**
 * Requirement 15.3: with a measured result, the mean of the 2 long presses is below 1.5 × the
 * median of the 3 short ones, so calibrate() set long to 3 × short.
 */
export function closePressesShown(s: OnboardingState): boolean {
  if (s.result.kind !== 'measured' || s.durations.length !== PRACTICE_PRESSES) return false;
  const [a = 0, b = 0, c = 0, d = 0, e = 0] = s.durations;
  const [, median = 0] = [a, b, c].sort((x, y) => x - y);
  return (d + e) / 2 < 1.5 * median;
}
