/**
 * Onboarding_Flow state, actions and effects (design "lib/onboarding/types.ts", Requirement 17).
 */
import type { SourceStatus } from '@/lib/input';
import type { Calibration, Estimates } from '@/lib/morse';

export type InputChoice = 'key-tap' | 'switch' | 'blink';
export type Step = 'input' | 'practice' | 'legend' | 'done' | 'cancelled';
export type Origin = 'first-run' | 'rerun';

export type SwitchPhase =
  | { readonly kind: 'idle' }
  /** "Press the switch now." */
  | { readonly kind: 'armed' }
  /** "Switch learned." plus the key code */
  | { readonly kind: 'learned'; readonly code: string }
  /** The learner's message, "Try again" and "Use key or tap instead" */
  | { readonly kind: 'failed'; readonly message: string };

export type BlinkPhase =
  | { readonly kind: 'idle' }
  /** The camera explanation and "Turn on camera" */
  | { readonly kind: 'explained' }
  | { readonly kind: 'started'; readonly status: SourceStatus };

export type PracticeResult =
  | { readonly kind: 'none' }
  /** calibration.reason === null */
  | { readonly kind: 'measured'; readonly calibration: Calibration }
  /** null after "Use default speed"; a fallback keeps its non-null-reason Calibration */
  | { readonly kind: 'default'; readonly calibration: Calibration | null };

export interface OnboardingReport {
  readonly complete: true;
  readonly inputChoice: InputChoice;
  readonly estimates: Estimates | null;
}

export interface OnboardingState {
  readonly step: Step;
  readonly origin: Origin;
  /** The tile shown as selected. */
  readonly selected: InputChoice | null;
  /** The confirmed Input_Choice; Continue on the Input_Step is enabled iff non-null. */
  readonly inputChoice: InputChoice | null;
  readonly switchPhase: SwitchPhase;
  readonly blinkPhase: BlinkPhase;
  /** 0 to 5 Practice_Press durations since the latest Practice_Step start. */
  readonly durations: readonly number[];
  /** A `down` received in this Practice_Step, awaiting its `up`. */
  readonly heldDownT: number | null;
  readonly result: PracticeResult;
  /** Set once by "Use this speed" or Continue on the Practice_Step. */
  readonly applied: Estimates | null | 'unset';
  /** Set once on Start. */
  readonly report: OnboardingReport | null;
}

export type SwitchLearnResult =
  | { readonly ok: true; readonly code: string }
  | { readonly ok: false; readonly message: string };

export type OnboardingAction =
  | { readonly type: 'choose'; readonly choice: InputChoice }
  | { readonly type: 'switch-result'; readonly result: SwitchLearnResult }
  | { readonly type: 'switch-retry' }
  /** "Turn on camera" and blink "Try again" */
  | { readonly type: 'camera-on' }
  | { readonly type: 'blink-status'; readonly status: SourceStatus }
  /** "Use key or tap instead" */
  | { readonly type: 'use-key-tap' }
  | { readonly type: 'continue' }
  | { readonly type: 'press'; readonly kind: 'down' | 'up'; readonly t: number }
  | { readonly type: 'use-default' }
  | { readonly type: 'practice-again' }
  | { readonly type: 'use-this-speed' }
  | { readonly type: 'start' }
  | { readonly type: 'cancel' };

export type OnboardingEffect =
  | { readonly type: 'arm-learner' }
  | { readonly type: 'disarm-learner' }
  | { readonly type: 'start-blink' }
  | { readonly type: 'stop-blink' }
  | { readonly type: 'apply-estimates'; readonly estimates: Estimates | null }
  | { readonly type: 'focus-keying-surface' }
  | { readonly type: 'focus-selected-choice' }
  | { readonly type: 'finish'; readonly report: OnboardingReport }
  | { readonly type: 'cancel' };
