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

// Feature: onboarding-and-safety, review 24.3: finished input choice determines the switch source.
it('disables and clears switch input when finishing or restoring another input', () => {
  fc.assert(fc.property(fc.constantFrom('key-tap', 'blink'), (choice) => {
    const clock = createManualClock(0);
    const backend = memoryBackend();
    const sources = createFakeSourceControl();
    let cleared = 0;
    const learner = { ...createFakeSwitchLearner(), clear: () => { cleared += 1; return { ok: true, value: undefined } as const; } };
    const controller = createOnboardingController({ backend: () => backend, clock: () => clock.now, scheduler: () => createManualScheduler(clock.now), createEngine: createFakeEngineFactory().create, alarm: { start() {} }, router: { onOnboardingOpenChange() {} } });
    const api = { setInitialEstimates() {}, focusKeyingSurface() {}, focusSelectedChoice() {}, settings: () => DEFAULT_SETTINGS, sources, learner, pendingSince: () => null };
    controller.attach(api);
    controller.dispatch({ type: 'choose', choice });
    if (choice === 'blink') { controller.dispatch({ type: 'camera-on' }); controller.dispatch({ type: 'blink-status', status: 'active' }); }
    expect(sources.enabled().switch).toBe(false);
    expect(cleared).toBe(1);
    for (const type of ['continue', 'use-default', 'continue', 'start'] as const) controller.dispatch({ type });
    expect(sources.enabled().switch).toBe(false);
    expect(cleared).toBe(1);
    expect(controller.isOpen()).toBe(false);
    const restoredSources = createFakeSourceControl();
    const restored = createOnboardingController({ backend: () => backend, clock: () => clock.now, scheduler: () => createManualScheduler(clock.now), createEngine: createFakeEngineFactory().create, alarm: { start() {} }, router: { onOnboardingOpenChange() {} } });
    restored.attach({ ...api, sources: restoredSources });
    expect(restoredSources.enabled().switch).toBe(false);
    expect(cleared).toBe(2);
  }), { numRuns: PROP_RUNS });
});
