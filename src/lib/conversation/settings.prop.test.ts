import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { RATE_MAX, RATE_MIN, WPM_MAX, WPM_MIN, validateSettingsPatch } from './settings';
import { PROP_RUNS, arbSettingsRecord } from './test-support';

const RANGES = {
  speechRate: { min: RATE_MIN, max: RATE_MAX },
  startingWpm: { min: WPM_MIN, max: WPM_MAX },
} as const;

const fieldArb = fc.constantFrom<keyof typeof RANGES>('speechRate', 'startingWpm');

/** Finite numbers around and inside the range, non-finite numbers, numeric strings, null and other values. */
function patchValueArb(field: keyof typeof RANGES): fc.Arbitrary<unknown> {
  const { min, max } = RANGES[field];
  return fc.oneof(
    fc.constantFrom(min, max, min - 0.01, max + 0.01, 0, -1),
    fc.double({ min: min - 2, max: max + 2, noNaN: true }),
    fc.double(),
    fc.constantFrom(Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY),
    fc.double({ min, max, noNaN: true }).map(String),
    fc.string({ maxLength: 4 }),
    fc.constant(null),
    fc.constantFrom(true, [], {}),
  );
}

describe('settings properties', () => {
  // Feature: conversation-ui, Property 15: Settings validation rejects out-of-range values
  it('P15 settings validation rejects out-of-range values', () => {
    fc.assert(
      fc.property(
        arbSettingsRecord(),
        fieldArb.chain((field) => patchValueArb(field).map((value) => ({ field, value }))),
        (current, { field, value }) => {
          const before = structuredClone(current);
          const result = validateSettingsPatch(current, { [field]: value });
          const { min, max } = RANGES[field];
          const valid = typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
          if (valid) {
            expect(result).toEqual({ ok: true, value: { ...current, [field]: value } });
          } else {
            expect(result.ok).toBe(false);
            if (!result.ok) expect(result.error.map((e) => e.field)).toEqual([field]);
          }
          expect(current).toEqual(before);
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
