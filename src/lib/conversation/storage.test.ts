import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './settings';
import { HISTORY_KEY, SETTINGS_KEY, createConversationStorage, memoryBackend } from './storage';
import { throwingBackend } from './test-support';

describe('createConversationStorage', () => {
  it('writes an empty History_Record for an empty history', () => {
    const backend = throwingBackend();
    const storage = createConversationStorage(backend);
    expect(storage.saveHistory([])).toEqual({ ok: true, value: undefined });
    expect(backend.writes).toEqual([[HISTORY_KEY, '{"v":1,"turns":[]}']]);
  });

  it('stores Turns without their IDs, in order', () => {
    const backend = memoryBackend();
    const storage = createConversationStorage(backend);
    storage.saveHistory([
      { id: 4, role: 'partner', text: 'Are you thirsty?' },
      { id: 9, role: 'speaker', text: 'Yes, water please.' },
    ]);
    expect(JSON.parse(backend.getItem(HISTORY_KEY) ?? '')).toEqual({
      v: 1,
      turns: [
        { role: 'partner', text: 'Are you thirsty?' },
        { role: 'speaker', text: 'Yes, water please.' },
      ],
    });
  });

  it('loads defaults with no error when nothing is stored', () => {
    const storage = createConversationStorage(memoryBackend());
    expect(storage.loadHistory()).toEqual({ record: { v: 1, turns: [] }, error: null });
    expect(storage.loadSettings()).toEqual({ record: DEFAULT_SETTINGS, error: null });
  });

  it('keeps one record when the other is corrupt', () => {
    const storage = createConversationStorage(
      memoryBackend({
        [HISTORY_KEY]: '{"v":1,"turns":[{"role":"speaker","text":"hi"}]}',
        [SETTINGS_KEY]: '{"v":1,"speechRate":9}',
      }),
    );
    expect(storage.loadHistory().record.turns).toEqual([{ role: 'speaker', text: 'hi' }]);
    expect(storage.loadSettings().record).toEqual(DEFAULT_SETTINGS);
  });

  it('reads, writes and clears the switch key inside the Settings_Record', () => {
    const backend = memoryBackend();
    const storage = createConversationStorage(backend);
    storage.loadSettings();
    expect(storage.readSwitchKey()).toEqual({ ok: true, value: null });
    expect(storage.writeSwitchKey('KeyJ')).toEqual({ ok: true, value: undefined });
    expect(storage.readSwitchKey()).toEqual({ ok: true, value: 'KeyJ' });
    expect(JSON.parse(backend.getItem(SETTINGS_KEY) ?? '')).toMatchObject({ switchKey: 'KeyJ', speechRate: 1 });

    const reloaded = createConversationStorage(backend);
    expect(reloaded.readSwitchKey()).toEqual({ ok: true, value: 'KeyJ' });
    expect(reloaded.clearSwitchKey().ok).toBe(true);
    expect(createConversationStorage(backend).readSwitchKey()).toEqual({ ok: true, value: null });
  });

  it('reports a read error and a failed write when storage is disabled, without throwing', () => {
    const storage = createConversationStorage(throwingBackend({ get: true, set: true }));
    expect(storage.loadHistory()).toEqual({
      record: { v: 1, turns: [] },
      error: { op: 'read', record: 'history', message: expect.any(String) },
    });
    expect(storage.loadSettings().error).toMatchObject({ op: 'read', record: 'settings' });
    const saved = storage.saveSettings({ ...DEFAULT_SETTINGS, flip: true });
    expect(saved).toMatchObject({ ok: false, error: { op: 'write', record: 'settings' } });
    expect(storage.settings()).toEqual(DEFAULT_SETTINGS);
    expect(storage.writeSwitchKey('KeyJ')).toEqual({ ok: false, error: { message: expect.any(String) } });
  });

  it('writes only its two keys', () => {
    const backend = throwingBackend();
    const storage = createConversationStorage(backend);
    storage.saveHistory([{ id: 1, role: 'speaker', text: 'ok' }]);
    storage.saveSettings(DEFAULT_SETTINGS);
    storage.writeSwitchKey('F13');
    expect(new Set(backend.writes.map(([key]) => key))).toEqual(new Set([HISTORY_KEY, SETTINGS_KEY]));
  });
});
