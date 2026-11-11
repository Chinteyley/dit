// Public API of the conversation core. browser.ts (localStorage access) is imported from its own
// file by the session hook, and test-support.ts stays private to tests.
export {
  DEFAULT_ENABLED_SOURCES,
  inertAlarmHandler,
  inertUnknownPatternHandler,
  sessionOnlyRouter,
  unavailableLearner,
} from './handlers';
export type {
  AlarmHandler,
  EnabledSources,
  PressRouter,
  SessionPressTarget,
  SourceControl,
  UnknownPatternHandler,
} from './handlers';
export {
  ANNOUNCE_INTERVAL_MS,
  INITIAL_LIVE_QUEUE,
  announcementsFor,
  enqueue,
  flush,
  joinItems,
  suggestionsItemText,
} from './live-queue';
export type { LiveItem, LiveQueueState, LiveStep } from './live-queue';
export { INITIAL_SESSION, contextWindow, reduce, trimmedText } from './session';
export {
  DEFAULT_SETTINGS,
  InputSettingsSchema,
  RATE_DEFAULT,
  RATE_MAX,
  RATE_MIN,
  RATE_RANGE_MESSAGE,
  SettingsRecordSchema,
  WPM_DEFAULT,
  WPM_MAX,
  WPM_MIN,
  WPM_RANGE_MESSAGE,
  engineConfigOf,
  validateSettingsPatch,
} from './settings';
export type { PatchError, SettingsPatch, SettingsRecord } from './settings';
export {
  HISTORY_KEY,
  HistoryRecordSchema,
  SETTINGS_KEY,
  createConversationStorage,
  memoryBackend,
} from './storage';
export type { ConversationStorage, HistoryRecord, KeyValueBackend, StorageError } from './storage';
export { CONTEXT_WINDOW, HISTORY_CAP, TEXT_MAX } from './types';
export type {
  HydrateEntry,
  SessionAction,
  SessionEffect,
  SessionState,
  SessionTurn,
  SuggestionSource,
  Transition,
} from './types';
