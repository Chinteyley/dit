// Public API of the Morse engine. step, deadlineOf and test-support stay private to this folder.
export { calibrate } from './calibrate';
export type { Calibration, CalibrationReason } from './calibrate';
export { CHARACTER_TABLE, COMMAND_TABLE, SUPPORTED_CHARACTERS, lookupPattern } from './codes';
export type { Lookup } from './codes';
export { createEngine, decodedText } from './decoder';
export type { DecoderState, Engine, EngineInput } from './decoder';
export { encode, normalizeText } from './encode';
export type {
  EncodeError,
  EncodeTextError,
  EncodedSequence,
  PressInput,
  UnsupportedOccurrence,
} from './encode';
export { err, ok } from './result';
export type { Result } from './result';
export {
  DEFAULT_ADAPTATION_RATE,
  DEFAULT_UNIT,
  DEFAULT_WPM,
  MAX_START_WPM,
  MAX_SYMBOLS,
  MAX_UNIT,
  MIN_START_WPM,
  MIN_UNIT,
  unitToWpm,
  wpmToUnit,
} from './timing';
export type {
  CommandName,
  EngineConfig,
  EngineConfigError,
  EngineEvent,
  EngineMode,
  EstimateSnapshot,
  Estimates,
  MorseSymbol,
} from './types';
