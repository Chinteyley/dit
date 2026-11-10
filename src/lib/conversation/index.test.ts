import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as conversation from './index';

describe('conversation barrel', () => {
  it('exports the session core', () => {
    for (const name of [
      'reduce',
      'INITIAL_SESSION',
      'enqueue',
      'flush',
      'announcementsFor',
      'validateSettingsPatch',
      'engineConfigOf',
      'createConversationStorage',
      'memoryBackend',
      'sessionOnlyRouter',
      'unavailableLearner',
      'DEFAULT_ENABLED_SOURCES',
    ]) {
      expect(conversation).toHaveProperty(name);
    }
  });

  it('does not re-export the browser adapter or the test support', () => {
    expect(conversation).not.toHaveProperty('localStorageBackend');
    expect(conversation).not.toHaveProperty('PROP_RUNS');
    const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/from '\.\/(browser|test-support)'/);
  });
});
