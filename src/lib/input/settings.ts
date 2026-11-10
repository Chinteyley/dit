import { validateThresholds, type ThresholdError } from './blink/detector';
import { DEFAULT_MIN_PRESS, validateMinPressDuration } from './debounce';
import { SOURCE_KINDS, err, ok, type Result, type SettingError, type SourceKind } from './types';

export interface StoreError {
  readonly message: string;
}

/** Implemented by the conversation layer, which validates stored values with Zod. */
export interface SettingsStore {
  /** unknown: validated by validateSwitchKey (Req 5.8). */
  readSwitchKey(): Result<unknown, StoreError>;
  writeSwitchKey(code: string): Result<void, StoreError>;
  clearSwitchKey(): Result<void, StoreError>;
}

export interface InputSettings {
  readonly minPressDuration: Readonly<Record<SourceKind, number>>;
  readonly closeThreshold: number;
  readonly openThreshold: number;
}

export const DEFAULT_INPUT_SETTINGS: InputSettings = Object.freeze({
  minPressDuration: DEFAULT_MIN_PRESS,
  closeThreshold: 0.5,
  openThreshold: 0.35,
});

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Applies the same range checks as the source setters, so both paths agree (Req 3.8, 8.13). */
export function validateInputSettings(value: unknown): Result<InputSettings, readonly (SettingError | ThresholdError)[]> {
  const errors: (SettingError | ThresholdError)[] = [];
  const durations = field(value, 'minPressDuration');
  const minPressDuration: Partial<Record<SourceKind, number>> = {};
  for (const kind of SOURCE_KINDS) {
    const result = validateMinPressDuration(kind, field(durations, kind));
    if (result.ok) minPressDuration[kind] = result.value;
    else errors.push(result.error);
  }
  const thresholds = validateThresholds(field(value, 'closeThreshold'), field(value, 'openThreshold'));
  if (!thresholds.ok) errors.push(thresholds.error);

  const { keyboard, switch: switchMin, pointer, blink } = minPressDuration;
  if (
    errors.length > 0 ||
    !thresholds.ok ||
    keyboard === undefined ||
    switchMin === undefined ||
    pointer === undefined ||
    blink === undefined
  ) {
    return err(errors);
  }
  return ok({
    minPressDuration: { keyboard, switch: switchMin, pointer, blink },
    closeThreshold: thresholds.value.close,
    openThreshold: thresholds.value.open,
  });
}
