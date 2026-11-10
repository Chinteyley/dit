import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calibrate, type CalibrationReason } from './calibrate';
import { PROP_RUNS, engineFor } from './test-support';
import { applyEstimateGuards } from './timing';

const durationArb = fc.double({ min: 1e-3, max: 1e5, noNaN: true });

const median3 = (values: readonly number[]): number => [...values].sort((a, b) => a - b)[1] ?? Number.NaN;

const validListArb = fc.oneof(
  fc.array(durationArb, { minLength: 5, maxLength: 5 }),
  // Long presses of exactly 1.5 × the median short press sit on the keep-or-replace boundary.
  fc.array(durationArb, { minLength: 3, maxLength: 3 }).map((shorts) => {
    const boundary = 1.5 * median3(shorts);
    return [...shorts, boundary, boundary];
  }),
);

const isDuration = (value: unknown): boolean =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

/** Expected reason for any input, written independently of calibrate.ts. */
function oracleReason(input: unknown): CalibrationReason | null {
  if (!Array.isArray(input)) return { kind: 'not-a-list' };
  if (input.length !== 5) return { kind: 'wrong-length', length: input.length };
  for (let i = 0; i < 5; i += 1) {
    if (!isDuration(input[i])) return { kind: 'invalid-duration', position: i + 1 };
  }
  return null;
}

function cloneIfPossible(value: unknown): { cloned: boolean; copy: unknown } {
  try {
    return { cloned: true, copy: structuredClone(value) };
  } catch {
    return { cloned: false, copy: undefined };
  }
}

const anyInputArb = fc.oneof(
  fc.anything(),
  fc.array(fc.double(), { maxLength: 10 }).filter((list) => list.length !== 5),
  fc
    .tuple(
      fc.array(durationArb, { minLength: 5, maxLength: 5 }),
      fc.integer({ min: 0, max: 4 }),
      fc.constantFrom<unknown>(0, -1, Number.NaN, Infinity, -Infinity, '5', null),
    )
    .map(([list, position, bad]) => list.map((value, i): unknown => (i === position ? bad : value))),
);

describe('calibration properties', () => {
  it('matches the median and mean model and the engine keeps the result exactly', () => {
    // Feature: morse-engine, Property 16: Calibration matches the median/mean model
    fc.assert(
      fc.property(validListArb, (durations) => {
        const dot = median3(durations.slice(0, 3));
        const meanLong = ((durations[3] ?? 0) + (durations[4] ?? 0)) / 2;
        const expected = applyEstimateGuards({
          dotEstimate: dot,
          dashEstimate: meanLong < 1.5 * dot ? 3 * dot : meanLong,
        });
        const result = calibrate(durations);
        expect(result).toStrictEqual({ ...expected, reason: null });

        for (const mode of ['adaptive', 'fixed'] as const) {
          const engine = engineFor({
            mode,
            initialDotEstimate: result.dotEstimate,
            initialDashEstimate: result.dashEstimate,
          });
          expect(engine.estimates().dotEstimate).toBe(result.dotEstimate);
          expect(engine.estimates().dashEstimate).toBe(result.dashEstimate);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });

  it('never throws or mutates, and says why it fell back', () => {
    // Feature: morse-engine, Property 17: Calibration is total, pure and reports why it fell back
    fc.assert(
      fc.property(anyInputArb, (input) => {
        const before = cloneIfPossible(input);
        const first = calibrate(input);
        const second = calibrate(input);
        expect(second).toStrictEqual(first);
        if (before.cloned) expect(input).toStrictEqual(before.copy);

        const reason = oracleReason(input);
        expect(first.reason).toStrictEqual(reason);
        if (reason !== null) {
          expect(first.dotEstimate).toBe(200);
          expect(first.dashEstimate).toBe(600);
        }
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
