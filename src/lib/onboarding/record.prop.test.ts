import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseOnboardingRecord, serializeOnboardingRecord } from './record';
import { PROP_RUNS, arbStoredRecord, arbValidRecord, isValidStoredRecord } from './test-support';

describe('Onboarding_Record properties', () => {
  // Feature: onboarding-and-safety, Property 26: Onboarding_Record serialization round trip
  it('P26 onboarding record serialization round trip', () => {
    fc.assert(
      fc.property(arbValidRecord(), (record) => {
        const json = serializeOnboardingRecord(record);
        expect(parseOnboardingRecord(json)).toEqual(record);
        expect(Object.keys(JSON.parse(json) as object)).toEqual(['v', 'complete', 'inputChoice', 'estimates']);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: onboarding-and-safety, Property 27: The record schema accepts exactly the valid records
  it('P27 the record schema accepts exactly the valid records', () => {
    fc.assert(
      fc.property(arbStoredRecord(), (raw) => {
        let parsed: ReturnType<typeof parseOnboardingRecord> = null;
        expect(() => {
          parsed = parseOnboardingRecord(raw);
        }).not.toThrow();
        expect(parsed !== null).toBe(isValidStoredRecord(raw));
        if (parsed !== null && raw !== null) expect(parsed).toEqual(JSON.parse(raw));
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
