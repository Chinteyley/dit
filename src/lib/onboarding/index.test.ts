import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as onboarding from './index';

describe('onboarding barrel', () => {
  it('exports the strings, models, reducer, record, store and controller', () => {
    for (const name of [
      'ALARM_TITLE',
      'SOUND_UNAVAILABLE_TEXT',
      'COMMAND_LABELS',
      'COMMAND_SENTENCES',
      'STEP_HEADINGS',
      'spokenCode',
      'speedText',
      'buildLegendModel',
      'legendAccessibleText',
      'buildCheatSheetModel',
      'entryAccessibleText',
      'cheatSheetStep',
      'createCheatSheetStore',
      'createUnknownPatternHandler',
      'placePanel',
      'initialFirstRun',
      'onboardingStep',
      'onboardingEffects',
      'practicePrompt',
      'ONBOARDING_KEY',
      'readOnboardingRecord',
      'writeOnboardingRecord',
      'createOnboardingController',
    ]) {
      expect(onboarding).toHaveProperty(name);
    }
  });

  it('does not re-export the fakes or the test support', () => {
    for (const name of ['createFakeEngine', 'createFakeSourceControl', 'createFakeSwitchLearner', 'PROP_RUNS', 'arbCode']) {
      expect(onboarding).not.toHaveProperty(name);
    }
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(fakes|test-support)'/);
  });
});
