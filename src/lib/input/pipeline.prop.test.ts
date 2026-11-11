import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  PROP_RUNS,
  alternates,
  deepFreeze,
  pipelineConfigArb,
  pipelineScriptArb,
  plain,
  runPipeline,
  scriptTimes,
} from './test-support';

describe('pure pipeline properties', () => {
  it('is deterministic, emits only input timestamps and never mutates its inputs', () => {
    // Feature: input-sources, Property 17: Determinism, input-only timestamps and no mutation
    fc.assert(
      fc.property(pipelineConfigArb, pipelineScriptArb, (config, script) => {
        const before = structuredClone(script);
        const first = runPipeline(config, script);
        const second = runPipeline(config, script);

        expect(plain(second)).toStrictEqual(plain(first));
        expect(alternates(first)).toBe(true);
        const times = scriptTimes(script);
        for (const event of first) {
          expect(times.has(event.t)).toBe(true);
        }
        // fast-check builds null-prototype records, so compare fields, not prototypes.
        expect(script).toEqual(before);

        const frozen = deepFreeze(structuredClone(script));
        expect(() => runPipeline(config, frozen)).not.toThrow();
        expect(plain(runPipeline(config, frozen))).toStrictEqual(plain(first));
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
