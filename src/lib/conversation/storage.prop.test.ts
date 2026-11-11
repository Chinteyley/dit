import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { HISTORY_KEY, SETTINGS_KEY, createConversationStorage, memoryBackend } from './storage';
import {
  PROP_RUNS,
  arbHistoryRecord,
  arbSettingsRecord,
  arbStoredHistory,
  arbStoredSettings,
  throwingBackend,
} from './test-support';
import type { SessionTurn } from './types';

describe('storage properties', () => {
  // Feature: conversation-ui, Property 13: Storage round-trip
  it('P13 storage round-trip', () => {
    fc.assert(
      fc.property(arbHistoryRecord(), arbSettingsRecord(), fc.integer({ min: 1, max: 10_000 }), (history, settings, firstId) => {
        const backend = memoryBackend();
        const writer = createConversationStorage(backend);
        const turns: SessionTurn[] = history.turns.map((turn, i) => ({ id: firstId + i, ...turn }));
        expect(writer.saveHistory(turns).ok).toBe(true);
        expect(writer.saveSettings(settings).ok).toBe(true);

        const reader = createConversationStorage(backend);
        expect(reader.loadHistory()).toEqual({ record: history, error: null });
        expect(reader.loadSettings()).toEqual({ record: settings, error: null });
        expect(reader.settings()).toEqual(settings);
      }),
      { numRuns: PROP_RUNS },
    );
  });

  // Feature: conversation-ui, Property 14: Storage survives bad data and failing backends
  it('P14 storage survives bad data and failing backends', () => {
    fc.assert(
      fc.property(
        arbStoredHistory(),
        arbStoredSettings(),
        fc.record({ get: fc.boolean(), set: fc.boolean() }),
        arbSettingsRecord(),
        (history, settings, failing, next) => {
          const initial: Record<string, string> = {};
          if (history.raw !== null) initial[HISTORY_KEY] = history.raw;
          if (settings.raw !== null) initial[SETTINGS_KEY] = settings.raw;
          const storage = createConversationStorage(throwingBackend({ ...failing, initial }));

          const loadedHistory = storage.loadHistory();
          const loadedSettings = storage.loadSettings();
          if (failing.get) {
            expect(loadedHistory.record.turns).toEqual([]);
            expect(loadedHistory.error).toMatchObject({ op: 'read', record: 'history' });
            expect(loadedSettings.record).toEqual(DEFAULT_SETTINGS);
            expect(loadedSettings.error).toMatchObject({ op: 'read', record: 'settings' });
          } else {
            expect(loadedHistory).toEqual({ record: { v: 1, turns: history.expected }, error: null });
            expect(loadedSettings).toEqual({ record: settings.expected, error: null });
          }

          const before = storage.settings();
          const savedSettings = storage.saveSettings(next);
          const savedHistory = storage.saveHistory([{ id: 1, role: 'partner', text: 'hello' }]);
          const savedKey = storage.writeSwitchKey('KeyJ');
          if (failing.set) {
            expect(savedSettings).toMatchObject({ ok: false, error: { op: 'write', record: 'settings' } });
            expect(savedHistory).toMatchObject({ ok: false, error: { op: 'write', record: 'history' } });
            expect(savedKey.ok).toBe(false);
            expect(storage.settings()).toEqual(before);
          } else {
            expect(savedSettings.ok && savedHistory.ok && savedKey.ok).toBe(true);
            expect(storage.settings()).toEqual({ ...next, switchKey: 'KeyJ' });
          }
        },
      ),
      { numRuns: PROP_RUNS },
    );
  });
});
