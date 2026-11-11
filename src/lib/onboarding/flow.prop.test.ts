import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { SourceStatus } from '@/lib/input';
import { calibrate, type Estimates } from '@/lib/morse';
import {
  continueEnabled,
  heldIndicatorShown,
  initialFirstRun,
  initialRerun,
  isOpenStep,
  onboardingEffects,
  onboardingStep,
} from './flow';
import {
  PROP_RUNS_HEAVY,
  arbFallbackDurations,
  arbOnboardingActions,
  deepFreeze,
  foldOnboarding,
  heldCalibrationOf,
  isValidAction,
  type OnboardingFoldStep,
} from './test-support';
import type { InputChoice, OnboardingAction, OnboardingEffect, OnboardingState } from './types';

const ORDER = ['input', 'practice', 'legend', 'done'] as const;

/** True when `next` starts with every value of `prev`, in order (NaN equals NaN). */
const extends_ = (prev: readonly number[], next: readonly number[]): boolean =>
  next.length >= prev.length && prev.every((d, i) => Object.is(d, next[i]));

/** A Practice_Step starts on Continue from the Input_Step and restarts on an accepted practice-again. */
const startsPractice = ({ prev, action, next }: OnboardingFoldStep): boolean =>
  next.step === 'practice' &&
  ((prev.step === 'input' && action.type === 'continue') ||
    (prev.step === 'practice' && action.type === 'practice-again' && heldCalibrationOf(prev) !== null));

/** Practice presses that build the given durations: down at T, up at T + d. */
const pressesFor = (durations: readonly number[]): OnboardingAction[] =>
  durations.flatMap((d, i): OnboardingAction[] => {
    const t = 10_000 * (i + 1);
    return [
      { type: 'press', kind: 'down', t },
      { type: 'press', kind: 'up', t: t + d },
    ];
  });

const applied = (effects: readonly OnboardingEffect[]): Extract<OnboardingEffect, { type: 'apply-estimates' }>[] =>
  effects.filter((e): e is Extract<OnboardingEffect, { type: 'apply-estimates' }> => e.type === 'apply-estimates');

describe('Onboarding_Reducer properties', () => {
  // Feature: onboarding-and-safety, Property 18: Onboarding steps advance only in order
  it('P18 onboarding steps advance only in order', () => {
    fc.assert(
      fc.property(arbOnboardingActions(), ({ initial, actions }) => {
        for (const step of foldOnboarding(initial, actions)) {
          const { prev, action, next } = step;
          if (prev.step === 'cancelled' || prev.step === 'done') {
            expect(next.step).toBe(prev.step);
            continue;
          }
          if (next.step === 'cancelled') {
            expect(action.type).toBe('cancel');
            expect(isOpenStep(prev.step)).toBe(true);
            expect(prev.origin).toBe('rerun');
            continue;
          }
          const from = ORDER.indexOf(prev.step);
          const to = ORDER.indexOf(next.step);
          expect(to === from || to === from + 1).toBe(true);
          if (prev.step === 'practice' && next.step === 'practice') {
            const restarted =
              !extends_(prev.durations, next.durations) || (heldCalibrationOf(prev) !== null && next.result.kind === 'none');
            if (restarted) {
              expect(action.type).toBe('practice-again');
              expect(heldCalibrationOf(prev)).not.toBeNull();
            }
          }
          if (next.step === 'legend' && prev.step === 'practice') {
            const viaSpeed = action.type === 'use-this-speed' && prev.result.kind === 'measured';
            const viaDefault = action.type === 'continue' && prev.result.kind === 'default';
            expect(viaSpeed || viaDefault).toBe(true);
          }
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 19: Only the first 5 Practice_Presses since the latest Practice_Step start count
  it('P19 only the first 5 practice presses since the latest practice start count', () => {
    fc.assert(
      fc.property(arbOnboardingActions(), ({ initial, actions }) => {
        let held: number | null = null;
        let pairs: number[] = [];
        for (const step of foldOnboarding(initial, actions)) {
          const { prev, action, next } = step;
          if (startsPractice(step)) {
            held = null;
            pairs = [];
          } else if (prev.step === 'practice' && action.type === 'use-default') {
            held = null;
          } else if (prev.step === 'practice' && prev.result.kind === 'none' && action.type === 'press') {
            // A Press_Pair: a down received in this Practice_Step and the next up.
            if (action.kind === 'down') {
              if (held === null && pairs.length < 5) held = action.t;
            } else if (held !== null) {
              pairs.push(action.t - held);
              held = null;
            }
          }
          if (next.step !== 'practice') continue;
          expect(next.durations.length).toBeLessThanOrEqual(5);
          expect(next.durations).toEqual(pairs.slice(0, 5));
          if (action.type === 'use-default') expect(next.durations).toEqual(prev.durations);
          expect(heldIndicatorShown(next)).toBe(held !== null && pairs.length < 5);
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 20: The held Calibration_Result equals calibrate() of the collected durations
  it('P20 the held calibration equals calibrate of the collected durations', () => {
    fc.assert(
      fc.property(arbOnboardingActions(), ({ initial, actions }) => {
        let skippedAfterFifth = false;
        for (const step of foldOnboarding(initial, actions)) {
          const { prev, action, next } = step;
          if (startsPractice(step)) skippedAfterFifth = false;
          if (prev.step === 'practice' && action.type === 'use-default' && prev.durations.length === 5) {
            skippedAfterFifth = true;
          }
          if (next.step !== 'practice') continue;
          if (next.durations.length < 5) {
            expect(heldCalibrationOf(next)).toBeNull();
          } else if (!skippedAfterFifth) {
            const c = calibrate(next.durations);
            expect(next.result).toEqual(
              c.reason === null ? { kind: 'measured', calibration: c } : { kind: 'default', calibration: c },
            );
          }
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 21: Skipping or a fallback calibration gives null estimates
  it('P21 skipping or a fallback calibration gives null estimates', () => {
    const finishFrom = (s: OnboardingState): { readonly applies: readonly OnboardingEffect[]; readonly done: OnboardingState } => {
      const legend = onboardingStep(s, { type: 'continue' });
      const done = onboardingStep(legend, { type: 'start' });
      return { applies: onboardingEffects(s, legend, { type: 'continue' }), done };
    };
    fc.assert(
      fc.property(
        arbOnboardingActions(),
        arbFallbackDurations(),
        fc.constantFrom<InputChoice>('key-tap', 'switch'),
        ({ initial, actions }, durations, choice) => {
          for (const { next } of foldOnboarding(initial, actions)) {
            if (next.step !== 'practice') continue;
            const skipped = onboardingStep(next, { type: 'use-default' });
            expect(skipped.result).toEqual({ kind: 'default', calibration: null });
            const { applies, done } = finishFrom(skipped);
            expect(applies).toEqual([{ type: 'apply-estimates', estimates: null }]);
            expect(done.report?.estimates).toBeNull();
          }
          let practice = onboardingStep(initialRerun(choice, 'off'), { type: 'continue' });
          for (const press of pressesFor(durations)) practice = onboardingStep(practice, press);
          expect(practice.result.kind).toBe('default');
          expect(heldCalibrationOf(practice)?.reason).not.toBeNull();
          expect(heldCalibrationOf(practice)).toEqual(calibrate(practice.durations));
          const { applies, done } = finishFrom(practice);
          expect(applies).toEqual([{ type: 'apply-estimates', estimates: null }]);
          expect(done.report).toEqual({ complete: true, inputChoice: choice, estimates: null });
        },
      ),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 22: Estimates are applied once and reported once per Onboarding_Flow
  it('P22 estimates are applied once and reported once per onboarding flow', () => {
    fc.assert(
      fc.property(arbOnboardingActions(), ({ initial, actions }) => {
        const steps = foldOnboarding(initial, actions);
        let confirmed: InputChoice | null = null;
        let appliedValue: Estimates | null | 'unset' = 'unset';
        let finishes = 0;
        let applications = 0;
        for (const { prev, action, next, effects } of steps) {
          if (prev.step === 'input' && next.step === 'practice') confirmed = prev.inputChoice;
          for (const effect of applied(effects)) {
            applications += 1;
            if (action.type === 'use-this-speed') {
              expect(prev.result.kind).toBe('measured');
              if (prev.result.kind === 'measured') {
                const { dotEstimate, dashEstimate } = prev.result.calibration;
                expect(effect.estimates).toEqual({ dotEstimate, dashEstimate });
              }
            } else {
              expect(action.type).toBe('continue');
              expect(prev.step).toBe('practice');
              expect(prev.result.kind).toBe('default');
              expect(effect.estimates).toBeNull();
            }
            appliedValue = effect.estimates;
          }
          for (const effect of effects) {
            if (effect.type !== 'finish') continue;
            finishes += 1;
            expect(effect.report).toEqual({ complete: true, inputChoice: confirmed, estimates: appliedValue });
          }
        }
        expect(applications).toBeLessThanOrEqual(1);
        expect(finishes).toBeLessThanOrEqual(1);
        const last = steps.at(-1)?.next ?? initial;
        if (last.step === 'done') {
          expect(finishes).toBe(1);
          expect(last.report).toEqual({ complete: true, inputChoice: confirmed, estimates: appliedValue });
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 23: Invalid onboarding actions are no-ops
  it('P23 invalid onboarding actions are no-ops', () => {
    fc.assert(
      fc.property(arbOnboardingActions(), ({ initial, actions }) => {
        let state = initial;
        for (const action of actions) {
          let next: OnboardingState = state;
          expect(() => {
            next = onboardingStep(state, action);
          }).not.toThrow();
          if (!isValidAction(state, action)) {
            expect(next).toEqual(state);
            expect(onboardingEffects(state, next, action)).toEqual([]);
          }
          state = next;
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 24: The Onboarding_Reducer is deterministic and does not mutate
  it('P24 the onboarding reducer is deterministic and does not mutate', () => {
    fc.assert(
      fc.property(arbOnboardingActions(), ({ initial, actions }) => {
        const plain = foldOnboarding(initial, actions);
        let state = deepFreeze(structuredClone(initial));
        actions.forEach((action, i) => {
          const frozenAction = deepFreeze(structuredClone(action));
          const next = onboardingStep(state, frozenAction);
          const effects = onboardingEffects(state, next, frozenAction);
          expect(next).toEqual(plain[i]?.next);
          expect(effects).toEqual(plain[i]?.effects);
          state = deepFreeze(next);
        });
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });

  // Feature: onboarding-and-safety, Property 25: Continue on the Input_Step is enabled exactly when an Input_Choice is confirmed
  it('P25 continue on the input step is enabled exactly when an input choice is confirmed', () => {
    const inputActions = new Set<OnboardingAction['type']>([
      'choose',
      'switch-result',
      'switch-retry',
      'camera-on',
      'blink-status',
      'use-key-tap',
    ]);
    const blinkStatusOf = (s: OnboardingState): SourceStatus | null =>
      s.blinkPhase.kind === 'started' ? s.blinkPhase.status : null;
    fc.assert(
      fc.property(arbOnboardingActions({ only: inputActions }), ({ initial, actions }) => {
        let switchConfirmed = initial.inputChoice === 'switch';
        let latestBlink = initial.selected === 'blink' ? blinkStatusOf(initial) : null;
        for (const { prev, action, next } of foldOnboarding(initial, actions)) {
          expect(next.step).toBe(prev.step);
          if (action.type === 'choose' || action.type === 'use-key-tap') {
            const choice = action.type === 'choose' ? action.choice : 'key-tap';
            if (!(choice === 'blink' && prev.selected === 'blink')) {
              switchConfirmed = false;
              latestBlink = null;
            }
            if (choice !== 'key-tap' && next !== prev) expect(next.inputChoice).toBeNull();
          } else if (action.type === 'switch-result' && prev.switchPhase.kind === 'armed') {
            switchConfirmed = action.result.ok;
          } else if (action.type === 'camera-on' && isValidAction(prev, action)) {
            latestBlink = 'starting';
          } else if (action.type === 'blink-status' && isValidAction(prev, action)) {
            latestBlink = action.status;
          }
          if (next.step !== 'input') continue;
          expect(continueEnabled(next)).toBe(next.inputChoice !== null);
          if (next.inputChoice === 'blink') {
            expect(next.selected).toBe('blink');
            expect(latestBlink === 'active' || latestBlink === 'face-lost').toBe(true);
          }
          if (next.inputChoice === 'switch') expect(switchConfirmed).toBe(true);
        }
      }),
      { numRuns: PROP_RUNS_HEAVY },
    );
  });
});

describe('generator coverage', () => {
  it('reaches Done and the Legend_Step in many runs', () => {
    const runs = fc.sample(arbOnboardingActions(), { numRuns: 300, seed: 7 });
    const finals = runs.map(({ initial, actions }) => foldOnboarding(initial, actions).at(-1)?.next ?? initial);
    expect(finals.filter((s) => s.step === 'done').length).toBeGreaterThan(60);
    expect(initialFirstRun().step).toBe('input');
  });
});
