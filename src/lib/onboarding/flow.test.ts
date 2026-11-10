import { describe, expect, it } from 'vitest';
import type { SourceStatus } from '@/lib/input';
import { calibrate } from '@/lib/morse';
import {
  closePressesShown,
  continueEnabled,
  heldIndicatorShown,
  initialFirstRun,
  initialRerun,
  isOpenStep,
  onboardingEffects,
  onboardingStep,
  practicePrompt,
} from './flow';
import type { InputChoice, OnboardingAction, OnboardingEffect, OnboardingState } from './types';

const ALL_STATUSES: readonly SourceStatus[] = [
  'off',
  'starting',
  'active',
  'face-lost',
  'permission-denied',
  'no-camera',
  'unsupported',
  'error',
];

/** Applies the actions in order and returns the final state and every effect. */
function run(
  start: OnboardingState,
  actions: readonly OnboardingAction[],
): { readonly state: OnboardingState; readonly effects: readonly OnboardingEffect[] } {
  let state = start;
  const effects: OnboardingEffect[] = [];
  for (const action of actions) {
    const next = onboardingStep(state, action);
    effects.push(...onboardingEffects(state, next, action));
    state = next;
  }
  return { state, effects };
}

/** One step: the next state and that step's effects. */
function step(s: OnboardingState, a: OnboardingAction) {
  const next = onboardingStep(s, a);
  return { next, effects: onboardingEffects(s, next, a) };
}

const presses = (durations: readonly number[], start = 1000): OnboardingAction[] => {
  let t = start;
  return durations.flatMap((d) => {
    const pair: OnboardingAction[] = [
      { type: 'press', kind: 'down', t },
      { type: 'press', kind: 'up', t: t + d },
    ];
    t += d + 400;
    return pair;
  });
};

const atPractice = (origin: 'first-run' | 'rerun' = 'first-run'): OnboardingState =>
  run(origin === 'first-run' ? initialFirstRun() : initialRerun('key-tap', 'off'), [
    { type: 'choose', choice: 'key-tap' },
    { type: 'continue' },
  ]).state;

const SHORT_LONG = [180, 200, 220, 600, 640];

describe('initial states', () => {
  it('opens a first run at the Input_Step with nothing chosen (Requirement 13.2)', () => {
    const s = initialFirstRun();
    expect(s).toMatchObject({ step: 'input', origin: 'first-run', selected: null, inputChoice: null });
    expect(s.switchPhase).toEqual({ kind: 'idle' });
    expect(s.blinkPhase).toEqual({ kind: 'idle' });
    expect(continueEnabled(s)).toBe(false);
  });

  it.each<InputChoice>(['key-tap', 'switch'])('selects and confirms the previous %s choice on a rerun', (choice) => {
    for (const status of ALL_STATUSES) {
      const s = initialRerun(choice, status);
      expect(s).toMatchObject({ step: 'input', origin: 'rerun', selected: choice, inputChoice: choice });
      expect(s.blinkPhase).toEqual({ kind: 'idle' });
      expect(continueEnabled(s)).toBe(true);
    }
  });

  it.each(ALL_STATUSES)('makes a Blink rerun follow the blink status %s (Requirement 13.9)', (status) => {
    const s = initialRerun('blink', status);
    expect(s.selected).toBe('blink');
    if (status === 'off') {
      expect(s.blinkPhase).toEqual({ kind: 'explained' });
    } else {
      expect(s.blinkPhase).toEqual({ kind: 'started', status });
    }
    expect(s.inputChoice).toBe(status === 'active' || status === 'face-lost' ? 'blink' : null);
  });

  it('treats input, practice and legend as open steps', () => {
    expect(['input', 'practice', 'legend', 'done', 'cancelled'].map((x) => isOpenStep(x as never))).toEqual([
      true,
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('Input_Step rows', () => {
  const first = initialFirstRun();

  it('choose key-tap confirms it and enables Continue (Requirement 13.3)', () => {
    const { next, effects } = step(first, { type: 'choose', choice: 'key-tap' });
    expect(next).toMatchObject({ selected: 'key-tap', inputChoice: 'key-tap' });
    expect(continueEnabled(next)).toBe(true);
    expect(effects).toEqual([]);
  });

  it('choose key-tap disarms an armed learner and stops a started camera', () => {
    const armed = step(first, { type: 'choose', choice: 'switch' }).next;
    expect(step(armed, { type: 'choose', choice: 'key-tap' }).effects).toEqual([{ type: 'disarm-learner' }]);
    const camera = run(first, [{ type: 'choose', choice: 'blink' }, { type: 'camera-on' }]).state;
    const { next, effects } = step(camera, { type: 'use-key-tap' });
    expect(effects).toEqual([{ type: 'stop-blink' }]);
    expect(next).toMatchObject({ selected: 'key-tap', inputChoice: 'key-tap', blinkPhase: { kind: 'idle' } });
  });

  it('choose switch arms the learner and clears the choice (Requirement 13.4)', () => {
    const keyTap = step(first, { type: 'choose', choice: 'key-tap' }).next;
    const { next, effects } = step(keyTap, { type: 'choose', choice: 'switch' });
    expect(next).toMatchObject({ selected: 'switch', inputChoice: null, switchPhase: { kind: 'armed' } });
    expect(effects).toEqual([{ type: 'arm-learner' }]);
    const camera = run(first, [{ type: 'choose', choice: 'blink' }, { type: 'camera-on' }]).state;
    expect(step(camera, { type: 'choose', choice: 'switch' }).effects).toEqual([
      { type: 'stop-blink' },
      { type: 'arm-learner' },
    ]);
  });

  it('a switch result confirms or fails the Switch choice (Requirements 13.5, 13.6)', () => {
    const armed = step(first, { type: 'choose', choice: 'switch' }).next;
    const learned = step(armed, { type: 'switch-result', result: { ok: true, code: 'KeyF' } });
    expect(learned.next).toMatchObject({ inputChoice: 'switch', switchPhase: { kind: 'learned', code: 'KeyF' } });
    expect(learned.effects).toEqual([]);
    const failed = step(armed, { type: 'switch-result', result: { ok: false, message: 'This key already works as an input.' } });
    expect(failed.next).toMatchObject({
      inputChoice: null,
      switchPhase: { kind: 'failed', message: 'This key already works as an input.' },
    });
    expect(continueEnabled(failed.next)).toBe(false);
    expect(step(first, { type: 'switch-result', result: { ok: true, code: 'KeyF' } }).next).toBe(first);
  });

  it('switch-retry re-arms only after a failure (Requirement 13.6)', () => {
    const failed = run(first, [
      { type: 'choose', choice: 'switch' },
      { type: 'switch-result', result: { ok: false, message: 'cancelled' } },
    ]).state;
    const { next, effects } = step(failed, { type: 'switch-retry' });
    expect(next.switchPhase).toEqual({ kind: 'armed' });
    expect(effects).toEqual([{ type: 'arm-learner' }]);
    expect(step(next, { type: 'switch-retry' }).next).toBe(next);
  });

  it('choose blink explains the camera and starts nothing (Requirement 13.7)', () => {
    const armed = step(first, { type: 'choose', choice: 'switch' }).next;
    const { next, effects } = step(armed, { type: 'choose', choice: 'blink' });
    expect(next).toMatchObject({ selected: 'blink', inputChoice: null, blinkPhase: { kind: 'explained' } });
    expect(effects).toEqual([{ type: 'disarm-learner' }]);
    expect(step(next, { type: 'choose', choice: 'blink' }).next).toBe(next);
  });

  it('camera-on starts the camera from the explanation and after a retryable failure (13.8, 13.10)', () => {
    const explained = step(first, { type: 'choose', choice: 'blink' }).next;
    const on = step(explained, { type: 'camera-on' });
    expect(on.next.blinkPhase).toEqual({ kind: 'started', status: 'starting' });
    expect(on.effects).toEqual([{ type: 'start-blink' }]);
    for (const status of ['permission-denied', 'no-camera', 'error'] as const) {
      const failed = step(on.next, { type: 'blink-status', status }).next;
      expect(step(failed, { type: 'camera-on' }).effects).toEqual([{ type: 'start-blink' }]);
    }
    const unsupported = step(on.next, { type: 'blink-status', status: 'unsupported' }).next;
    expect(step(unsupported, { type: 'camera-on' }).next).toBe(unsupported);
    expect(step(on.next, { type: 'camera-on' }).next).toBe(on.next);
  });

  it('blink-status confirms Blink only while active or face-lost (Requirements 13.9, 13.10)', () => {
    const starting = run(first, [{ type: 'choose', choice: 'blink' }, { type: 'camera-on' }]).state;
    for (const status of ALL_STATUSES) {
      const { next, effects } = step(starting, { type: 'blink-status', status });
      expect(next.inputChoice).toBe(status === 'active' || status === 'face-lost' ? 'blink' : null);
      expect(continueEnabled(next)).toBe(next.inputChoice !== null);
      expect(effects).toEqual([]);
    }
    const active = step(starting, { type: 'blink-status', status: 'active' }).next;
    expect(step(active, { type: 'blink-status', status: 'error' }).next.inputChoice).toBeNull();
    const explained = step(first, { type: 'choose', choice: 'blink' }).next;
    expect(step(explained, { type: 'blink-status', status: 'active' }).next).toBe(explained);
  });

  it('continue moves to a cleared Practice_Step and focuses the Keying_Surface (13.12, 14.1)', () => {
    const keyTap = step(first, { type: 'choose', choice: 'key-tap' }).next;
    const { next, effects } = step(keyTap, { type: 'continue' });
    expect(next).toMatchObject({ step: 'practice', durations: [], heldDownT: null, result: { kind: 'none' } });
    expect(effects).toEqual([{ type: 'focus-keying-surface' }]);
    expect(step(first, { type: 'continue' }).next).toBe(first); // 13.13
  });

  it('keeps a running Blink camera when continuing with Blink (Requirement 13.12)', () => {
    const active = run(first, [
      { type: 'choose', choice: 'blink' },
      { type: 'camera-on' },
      { type: 'blink-status', status: 'active' },
    ]).state;
    const { next, effects } = step(active, { type: 'continue' });
    expect(next.step).toBe('practice');
    expect(effects).toEqual([{ type: 'focus-keying-surface' }]);
  });
});

describe('Practice_Step rows', () => {
  const practice = atPractice();

  it('records a down, then the duration on its up (Requirement 14.3)', () => {
    const down = step(practice, { type: 'press', kind: 'down', t: 100 }).next;
    expect(down.heldDownT).toBe(100);
    expect(heldIndicatorShown(down)).toBe(true);
    const up = step(down, { type: 'press', kind: 'up', t: 100 }).next;
    expect(up.durations).toEqual([0]);
    expect(up.heldDownT).toBeNull();
    expect(heldIndicatorShown(up)).toBe(false);
  });

  it('ignores an up with no down and a second down while held (Requirement 14.8)', () => {
    expect(step(practice, { type: 'press', kind: 'up', t: 50 }).next).toBe(practice);
    const down = step(practice, { type: 'press', kind: 'down', t: 100 }).next;
    expect(step(down, { type: 'press', kind: 'down', t: 150 }).next).toBe(down);
  });

  it('calibrates on the fifth press and ignores later presses (Requirements 14.9, 15.1)', () => {
    const done = run(practice, presses(SHORT_LONG)).state;
    expect(done.durations).toEqual(SHORT_LONG);
    expect(done.result).toEqual({ kind: 'measured', calibration: calibrate(SHORT_LONG) });
    expect(step(done, { type: 'press', kind: 'down', t: 99_999 }).next).toBe(done);
    expect(practicePrompt(done)).toBeNull();
  });

  it('gives a default result for a fallback calibration (Requirement 15.4)', () => {
    const fallback = run(practice, presses([0, 200, 220, 600, 640])).state;
    expect(fallback.result.kind).toBe('default');
    if (fallback.result.kind === 'default') expect(fallback.result.calibration?.reason).not.toBeNull();
    expect(continueEnabled(fallback)).toBe(true);
  });

  it('use-default gives the default result, keeps the durations and adds none (14.11, 14.12)', () => {
    const two = run(practice, presses([180, 200])).state;
    const { next, effects } = step(two, { type: 'use-default' });
    expect(next.result).toEqual({ kind: 'default', calibration: null });
    expect(next.durations).toEqual([180, 200]);
    expect(effects).toEqual([]);
    expect(step(next, { type: 'use-default' }).next).toBe(next);
  });

  it('a later fifth press replaces the default result with the calibrated one', () => {
    const early = run(practice, [...presses([180, 200]), { type: 'use-default' }]).state;
    const fifth = run(early, presses([220, 600, 640], 50_000)).state;
    expect(fifth.result).toEqual({ kind: 'measured', calibration: calibrate(SHORT_LONG) });
  });

  it('practice-again restarts only while a Calibration is held (Requirement 15.5)', () => {
    expect(step(practice, { type: 'practice-again' }).next).toBe(practice);
    const measured = run(practice, presses(SHORT_LONG)).state;
    const { next, effects } = step(measured, { type: 'practice-again' });
    expect(next).toMatchObject({ step: 'practice', durations: [], heldDownT: null, result: { kind: 'none' } });
    expect(effects).toEqual([{ type: 'focus-keying-surface' }]);
    const fallback = run(practice, presses([0, 200, 220, 600, 640])).state;
    expect(step(fallback, { type: 'practice-again' }).next.durations).toEqual([]);
    const skipped = step(measured, { type: 'use-default' }).next;
    expect(step(skipped, { type: 'practice-again' }).next).toBe(skipped);
  });

  it('use-this-speed applies the measured estimates once and moves on (Requirement 15.6)', () => {
    const measured = run(practice, presses(SHORT_LONG)).state;
    const { next, effects } = step(measured, { type: 'use-this-speed' });
    const { dotEstimate, dashEstimate } = calibrate(SHORT_LONG);
    expect(next).toMatchObject({ step: 'legend', applied: { dotEstimate, dashEstimate } });
    expect(effects).toEqual([{ type: 'apply-estimates', estimates: { dotEstimate, dashEstimate } }]);
    expect(step(next, { type: 'use-this-speed' }).next).toBe(next); // 15.8
    expect(step(practice, { type: 'use-this-speed' }).next).toBe(practice);
  });

  it('continue applies null with a default result and moves on (Requirement 15.7)', () => {
    const skipped = step(practice, { type: 'use-default' }).next;
    const { next, effects } = step(skipped, { type: 'continue' });
    expect(next).toMatchObject({ step: 'legend', applied: null });
    expect(effects).toEqual([{ type: 'apply-estimates', estimates: null }]);
    expect(step(next, { type: 'continue' }).next).toBe(next);
    expect(step(practice, { type: 'continue' }).next).toBe(practice);
  });

  it('shows the close-presses sentence when the long presses were not clearly longer (15.3)', () => {
    expect(closePressesShown(run(practice, presses(SHORT_LONG)).state)).toBe(false);
    expect(closePressesShown(run(practice, presses([200, 200, 200, 250, 260])).state)).toBe(true);
    expect(closePressesShown(run(practice, presses([0, 200, 200, 250, 260])).state)).toBe(false);
  });
});

describe('practicePrompt', () => {
  it.each([
    [0, 'Press short', 'Press 1 of 5'],
    [1, 'Press short', 'Press 2 of 5'],
    [2, 'Press short', 'Press 3 of 5'],
    [3, 'Press long', 'Press 4 of 5'],
    [4, 'Press long', 'Press 5 of 5'],
  ] as const)('after %i presses says %s, %s', (n, prompt, count) => {
    const s = run(atPractice(), presses(SHORT_LONG.slice(0, n))).state;
    expect(practicePrompt(s)).toEqual({ prompt, count });
  });

  it('hides the prompt and count at 5 presses and outside the Practice_Step', () => {
    expect(practicePrompt(run(atPractice(), presses(SHORT_LONG)).state)).toBeNull();
    expect(practicePrompt(initialFirstRun())).toBeNull();
  });
});

describe('Legend_Step, Done and cancel rows', () => {
  it('start reports once and focuses the Keying_Surface (Requirements 16.4, 16.5, 16.7)', () => {
    const legend = run(atPractice(), [...presses(SHORT_LONG), { type: 'use-this-speed' }]).state;
    const { next, effects } = step(legend, { type: 'start' });
    const { dotEstimate, dashEstimate } = calibrate(SHORT_LONG);
    const report = { complete: true, inputChoice: 'key-tap', estimates: { dotEstimate, dashEstimate } };
    expect(next).toMatchObject({ step: 'done', report });
    expect(effects).toEqual([{ type: 'finish', report }, { type: 'focus-keying-surface' }]);
    expect(step(next, { type: 'start' }).next).toBe(next);
    expect(step(next, { type: 'cancel' }).next).toBe(next);
  });

  it('cancel closes a rerun from every open step, and never a first run (Requirements 11.8, 11.9)', () => {
    const rerun = initialRerun('switch', 'off');
    const states = [
      rerun,
      atPractice('rerun'),
      run(atPractice('rerun'), [{ type: 'use-default' }, { type: 'continue' }]).state,
    ];
    for (const s of states) {
      const { next, effects } = step(s, { type: 'cancel' });
      expect(next.step).toBe('cancelled');
      expect(effects).toEqual([{ type: 'disarm-learner' }, { type: 'cancel' }, { type: 'focus-keying-surface' }]);
      expect(step(next, { type: 'choose', choice: 'key-tap' }).next).toBe(next);
    }
    const first = atPractice('first-run');
    expect(step(first, { type: 'cancel' }).next).toBe(first);
  });

  it('ignores presses outside the Practice_Step (Requirement 17.8)', () => {
    const first = initialFirstRun();
    expect(step(first, { type: 'press', kind: 'down', t: 1 }).next).toBe(first);
    const legend = run(atPractice(), [{ type: 'use-default' }, { type: 'continue' }]).state;
    expect(step(legend, { type: 'press', kind: 'up', t: 1 }).next).toBe(legend);
  });
});

describe('the key-tap path (Requirement 16.8)', () => {
  it('finishes with 4 Partner actions and 5 presses, with no timed gate', () => {
    // Each press starts the moment the previous one ends: nothing waits for time to pass.
    let t = 0;
    const backToBack: OnboardingAction[] = SHORT_LONG.flatMap((d): OnboardingAction[] => {
      const pair: OnboardingAction[] = [
        { type: 'press', kind: 'down', t },
        { type: 'press', kind: 'up', t: t + d },
      ];
      t += d;
      return pair;
    });
    const partner: OnboardingAction[] = [
      { type: 'choose', choice: 'key-tap' },
      { type: 'continue' },
      { type: 'use-this-speed' },
      { type: 'start' },
    ];
    const [choose, cont, useThisSpeed, start] = partner as [OnboardingAction, OnboardingAction, OnboardingAction, OnboardingAction];
    const { state, effects } = run(initialFirstRun(), [choose, cont, ...backToBack, useThisSpeed, start]);
    expect(partner).toHaveLength(4);
    expect(backToBack).toHaveLength(10);
    expect(state.step).toBe('done');
    expect(state.report?.inputChoice).toBe('key-tap');
    expect(effects.filter((e) => e.type === 'finish')).toHaveLength(1);
    expect(effects.filter((e) => e.type === 'apply-estimates')).toHaveLength(1);
  });
});
