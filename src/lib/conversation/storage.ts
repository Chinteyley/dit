/**
 * Storage for the History_Record and the Settings_Record (design "lib/conversation/storage.ts",
 * Requirement 16). The backend is injected (localStorage in the browser, a Map in tests), every
 * read is validated with Zod, and no call ever throws: failures come back as values.
 *
 * Privacy: exactly two keys are written, only on this device; nothing here logs or sends data.
 */
import { z } from 'zod';
import { TurnSchema, type Role } from '@/lib/expansion';
import { err, ok, type Result, type SettingsStore, type StoreError } from '@/lib/input';
import { DEFAULT_SETTINGS, SettingsRecordSchema, type SettingsRecord } from './settings';
import { HISTORY_CAP, type SessionTurn } from './types';

export const HISTORY_KEY = 'dit:history:v1';
export const SETTINGS_KEY = 'dit:settings:v1';

/** The localStorage shape. Any method may throw (storage disabled or full). */
export interface KeyValueBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface HistoryRecord {
  readonly v: 1;
  readonly turns: readonly { readonly role: Role; readonly text: string }[];
}

/** Turns are TurnSchema entries; a record holding more than 200 keeps the newest 200 (Req 16.6). */
export const HistoryRecordSchema: z.ZodType<HistoryRecord> = z.object({
  v: z.literal(1),
  turns: z.array(TurnSchema).transform((turns) => turns.slice(-HISTORY_CAP)),
});

export interface StorageError {
  readonly op: 'read' | 'write';
  readonly record: 'history' | 'settings';
  readonly message: string;
}

export interface ConversationStorage extends SettingsStore {
  /** Never throws. Missing, bad JSON or schema failure → empty history (Req 16.4, 16.7). */
  loadHistory(): { readonly record: HistoryRecord; readonly error: StorageError | null };
  /** Never throws. Missing, bad JSON or schema failure → DEFAULT_SETTINGS (Req 16.4, 16.7). */
  loadSettings(): { readonly record: SettingsRecord; readonly error: StorageError | null };
  /** Writes the Turns without their IDs. A failed write leaves everything else unchanged (Req 16.8). */
  saveHistory(turns: readonly SessionTurn[]): Result<void, StorageError>;
  /** On success the record becomes settings(); on failure settings() is unchanged (Req 16.8). */
  saveSettings(record: SettingsRecord): Result<void, StorageError>;
  /** Current in-memory settings: the last loaded or saved record. */
  settings(): SettingsRecord;
}

const EMPTY_HISTORY: HistoryRecord = Object.freeze({ v: 1, turns: Object.freeze([]) });

const READ_FAILED = {
  history: 'The conversation history could not be read on this device.',
  settings: 'The settings could not be read on this device.',
} as const;
const WRITE_FAILED = {
  history: 'The conversation history could not be saved on this device.',
  settings: 'The settings could not be saved on this device.',
} as const;

export function createConversationStorage(backend: KeyValueBackend): ConversationStorage {
  let current: SettingsRecord | null = null;

  function read<T>(
    key: string,
    record: StorageError['record'],
    schema: z.ZodType<T>,
    fallback: T,
  ): { readonly record: T; readonly error: StorageError | null } {
    let raw: unknown;
    try {
      raw = backend.getItem(key);
    } catch {
      return { record: fallback, error: { op: 'read', record, message: READ_FAILED[record] } };
    }
    if (typeof raw !== 'string') return { record: fallback, error: null };
    try {
      const parsed = schema.safeParse(JSON.parse(raw));
      return { record: parsed.success ? parsed.data : fallback, error: null };
    } catch {
      return { record: fallback, error: null };
    }
  }

  function write(key: string, record: StorageError['record'], value: unknown): Result<void, StorageError> {
    try {
      backend.setItem(key, JSON.stringify(value));
      return ok(undefined);
    } catch {
      return err({ op: 'write', record, message: WRITE_FAILED[record] });
    }
  }

  const loadSettings: ConversationStorage['loadSettings'] = () => {
    const loaded = read(SETTINGS_KEY, 'settings', SettingsRecordSchema, DEFAULT_SETTINGS);
    current = loaded.record;
    return loaded;
  };

  const settings = (): SettingsRecord => current ?? loadSettings().record;

  const saveSettings: ConversationStorage['saveSettings'] = (record) => {
    const saved = write(SETTINGS_KEY, 'settings', record);
    if (saved.ok) current = record;
    return saved;
  };

  const toStoreError = (result: Result<void, StorageError>): Result<void, StoreError> =>
    result.ok ? result : err({ message: result.error.message });

  return {
    loadHistory: () => read(HISTORY_KEY, 'history', HistoryRecordSchema, EMPTY_HISTORY),
    loadSettings,
    saveHistory: (turns) =>
      write(HISTORY_KEY, 'history', { v: 1, turns: turns.map((turn) => ({ role: turn.role, text: turn.text })) }),
    saveSettings,
    settings,
    readSwitchKey: () => ok(settings().switchKey),
    writeSwitchKey: (code) => toStoreError(saveSettings({ ...settings(), switchKey: code })),
    clearSwitchKey: () => toStoreError(saveSettings({ ...settings(), switchKey: null })),
  };
}

/** An in-memory backend, used when localStorage is unavailable and in tests. */
export function memoryBackend(initial: Readonly<Record<string, string>> = {}): KeyValueBackend {
  const items = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => {
      items.set(key, String(value));
    },
    removeItem: (key) => {
      items.delete(key);
    },
  };
}
