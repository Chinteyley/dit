import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createEngine } from './decoder';
import { PROP_RUNS, invalidFieldArb, modeArb, validFieldArb } from './test-support';
import { applyEstimateGuards } from './timing';
import type { EngineConfig } from './types';

// Oracle: one predicate per setting, written independently of createEngine.
const isRealNumber = (value: unknown): value is number =>
  typeof value === 'number' && !Number.isNaN(value) && value !== Infinity && value !== -Infinity;
const validWpm = (value: unknown): boolean => isRealNumber(value) && value >= 2 && value <= 20;
const validRate = (value: unknown): boolean => isRealNumber(value) && value > 0 && value <= 1;
const validEstimate = (value: unknown): boolean => isRealNumber(value) && value > 0;

const configCaseArb = fc.record(
  {
    startingWpm: fc.oneof(validFieldArb.startingWpm, invalidFieldArb.startingWpm),
    adaptationRate: fc.oneof(validFieldArb.adaptationRate, invalidFieldArb.adaptationRate),
    initialDotEstimate: fc.oneof(validFieldArb.estimate, invalidFieldArb.estimate),
    initialDashEstimate: fc.oneof(validFieldArb.estimate, invalidFieldArb.estimate),
    mode: modeArb,
  },
  { requiredKeys: [] },
);

describe('config properties', () => {
  it('accepts a configuration exactly when every supplied setting is valid', () => {
    // Feature: morse-engine, Property 4: Engine configuration is accepted exactly when valid
    fc.assert(
      fc.property(configCaseArb, (config) => {
        const has = (key: keyof typeof config): boolean => Object.hasOwn(config, key);
        const expected: string[] = [];
        if (has('startingWpm') && !validWpm(config.startingWpm)) expected.push('startingWpm');
        if (has('adaptationRate') && !validRate(config.adaptationRate)) expected.push('adaptationRate');
        const dotGiven = has('initialDotEstimate');
        const dashGiven = has('initialDashEstimate');
        if (dotGiven ? !validEstimate(config.initialDotEstimate) : dashGiven) {
          expected.push(dotGiven ? 'initialDotEstimate:invalid' : 'initialDotEstimate:missing');
        }
        if (dashGiven ? !validEstimate(config.initialDashEstimate) : dotGiven) {
          expected.push(dashGiven ? 'initialDashEstimate:invalid' : 'initialDashEstimate:missing');
        }

        const result = createEngine(config as unknown as EngineConfig);
        if (expected.length > 0) {
          expect(result.ok).toBe(false);
          if (result.ok) return;
          expect('value' in result).toBe(false);
          const reported = result.error.map((error) =>
            'reason' in error ? `${error.setting}:${error.reason}` : error.setting,
          );
          expect([...reported].sort()).toStrictEqual([...expected].sort());
          return;
        }

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const engine = result.value;
        expect(engine.mode).toBe(config.mode ?? 'adaptive');
        const estimates = engine.estimates();
        if (dotGiven && dashGiven) {
          const guarded = applyEstimateGuards({
            dotEstimate: config.initialDotEstimate as number,
            dashEstimate: config.initialDashEstimate as number,
          });
          expect(estimates.dotEstimate).toBe(guarded.dotEstimate);
          expect(estimates.dashEstimate).toBe(guarded.dashEstimate);
        } else {
          const unit = 1200 / ((config.startingWpm as number | undefined) ?? 6);
          expect(estimates.dotEstimate).toBe(unit);
          expect(estimates.dashEstimate).toBe(3 * unit);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
