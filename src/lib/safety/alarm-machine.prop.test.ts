import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { alarmStep, isAlarmActive, isDismissal, type AlarmEffect, type AlarmState } from './alarm-machine';
import { PROP_RUNS, arbAlarmInputs, deepFreeze, foldAlarm, splitEpisodes, type AlarmStepRecord } from './test-support';

const count = (step: AlarmStepRecord, type: AlarmEffect['type']): number =>
  step.result.effects.filter((effect) => effect.type === type).length;

describe('Alarm_Machine properties', () => {
  // Feature: onboarding-and-safety, Property 1: Every press is consumed while the alarm is active, and none while idle
  it('P1 every press consumed while active and none while idle', () => {
    fc.assert(
      fc.property(arbAlarmInputs({ max: 200 }), (inputs) => {
        for (const step of foldAlarm(inputs)) {
          if (step.input === 'down' || step.input === 'up') {
            expect(step.result.consumed).toBe(step.before === 'ringing' || step.before === 'closing');
          } else {
            expect(step.result.consumed).toBe(false);
          }
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 2: Exactly one Dismissal per Alarm_Episode
  it('P2 exactly one dismissal per episode', () => {
    fc.assert(
      fc.property(arbAlarmInputs({ max: 200 }), (inputs) => {
        const steps = foldAlarm(inputs);
        for (const episode of splitEpisodes(steps)) {
          const dismissals = episode.steps.filter((step) => isDismissal(step.before, step.input));
          const hides = episode.steps.filter((step) => count(step, 'hide-card') > 0);
          const stops = episode.steps.filter((step) => count(step, 'stop-chime') > 0);
          const total = (type: AlarmEffect['type']): number =>
            episode.steps.reduce((sum, step) => sum + count(step, type), 0);
          if (episode.complete) {
            expect(dismissals).toHaveLength(1);
            expect(total('hide-card')).toBe(1);
            expect(total('stop-chime')).toBe(1);
            expect(hides[0]).toBe(dismissals[0]);
            expect(stops[0]).toBe(dismissals[0]);
          } else {
            expect(dismissals.length).toBeLessThanOrEqual(1);
            expect(total('hide-card')).toBeLessThanOrEqual(1);
            expect(total('stop-chime')).toBeLessThanOrEqual(1);
            for (const step of [...hides, ...stops]) expect(dismissals).toContain(step);
          }
        }
        for (const step of steps) {
          if (step.before === 'idle' || step.before === 'closing') {
            expect(count(step, 'hide-card') + count(step, 'stop-chime')).toBe(0);
          }
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 3: Active-change effects alternate and match isActive
  it('P3 active-change effects alternate and match isActive', () => {
    fc.assert(
      fc.property(arbAlarmInputs({ max: 200 }), (inputs) => {
        let last: boolean | null = null;
        for (const step of foldAlarm(inputs)) {
          const changes = step.result.effects.filter(
            (effect): effect is Extract<AlarmEffect, { type: 'active-change' }> => effect.type === 'active-change',
          );
          expect(changes.length).toBeLessThanOrEqual(1);
          const change = changes[0];
          if (change !== undefined) {
            expect(change.active).toBe(last === null ? true : !last);
            if (change.active) {
              expect([step.before, step.result.state]).toEqual(['idle', 'ringing']);
            } else {
              expect(['ringing', 'closing']).toContain(step.before);
              expect(step.result.state).toBe('idle');
            }
            last = change.active;
          }
          if (step.before === 'ringing' && step.result.state === 'closing') expect(change).toBeUndefined();
          expect(isAlarmActive(step.result.state)).toBe(last ?? false);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 4: The Alarm_Machine is deterministic and does not mutate
  it('P4 the alarm machine is deterministic and does not mutate', () => {
    fc.assert(
      fc.property(arbAlarmInputs({ max: 200 }), (inputs) => {
        const frozen = deepFreeze([...inputs]);
        const first = foldAlarm(frozen);
        const second = foldAlarm(frozen);
        expect(second).toEqual(first);
        // Results are frozen constants, so a caller can never mutate the machine's tables.
        let state: AlarmState = 'idle';
        for (const input of frozen) {
          const out = alarmStep(state, input);
          expect(Object.isFrozen(out)).toBe(true);
          expect(Object.isFrozen(out.effects)).toBe(true);
          state = out.state;
        }
        expect(frozen).toEqual(inputs);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
