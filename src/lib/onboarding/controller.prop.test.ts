import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, memoryBackend } from '@/lib/conversation';
import { createManualClock, createManualScheduler } from '@/lib/input';
import { createOnboardingController } from './controller';
import { createFakeEngineFactory, createFakeSourceControl, createFakeSwitchLearner } from './fakes';
import { initialFirstRun } from './flow';
import { ONBOARDING_KEY } from './record';
import { PROP_RUNS, arbStoredRecord, isValidStoredRecord } from './test-support';

describe('Onboarding controller properties', () => {
  // Feature: onboarding-and-safety, Property 28: The load decision follows the stored record
  it('P28 the load decision follows the stored record', () => {
    fc.assert(
      fc.property(arbStoredRecord(), (raw) => {
        const backend = memoryBackend(raw === null ? {} : { [ONBOARDING_KEY]: raw });
        const clock = createManualClock(0);
        const estimates: unknown[] = [];
        const controller = createOnboardingController({
          backend: () => backend,
          clock: () => clock.now,
          scheduler: () => createManualScheduler(clock.now),
          createEngine: createFakeEngineFactory().create,
          alarm: { start: () => undefined },
          router: { onOnboardingOpenChange: () => undefined },
        });
        controller.attach({
          setInitialEstimates: (e) => estimates.push(e),
          focusKeyingSurface: () => undefined,
          focusSelectedChoice: () => undefined,
          settings: () => DEFAULT_SETTINGS,
          sources: createFakeSourceControl(),
          learner: createFakeSwitchLearner(),
          pendingSince: () => null,
        });

        const complete = isValidStoredRecord(raw) && raw !== null && (JSON.parse(raw) as { complete: boolean }).complete;
        if (complete && raw !== null) {
          expect(controller.isOpen()).toBe(false);
          expect(controller.getView().state).toBeNull();
          expect(estimates).toEqual([(JSON.parse(raw) as { estimates: unknown }).estimates]);
        } else {
          expect(controller.isOpen()).toBe(true);
          expect(controller.getView().state).toEqual(initialFirstRun());
          expect(estimates).toEqual([]);
        }
        expect(backend.getItem(ONBOARDING_KEY)).toBe(raw);
      }),
      { numRuns: PROP_RUNS },
    );
  });
});
