import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as safety from './index';

describe('safety barrel', () => {
  it('exports the alarm, chime and router API', () => {
    for (const name of [
      'alarmStep',
      'isAlarmActive',
      'isDismissal',
      'createAlarmHandler',
      'chimeSchedule',
      'CHIME_PERIOD_MS',
      'TONES',
      'createChimePlayer',
      'LOOKAHEAD_HIDDEN_MS',
      'routePress',
      'createPressRouter',
      'INITIAL_ROUTER',
    ]) {
      expect(safety).toHaveProperty(name);
    }
  });

  it('does not re-export the browser adapter, the fakes or the test support', () => {
    for (const name of ['webAudioPort', 'installAudioUnlock', 'browserPageVisibility', 'createFakeAudioPort', 'PROP_RUNS']) {
      expect(safety).not.toHaveProperty(name);
    }
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(browser|fakes|test-support)'/);
  });
});
