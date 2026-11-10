/**
 * The Settings_Record: partner settings plus the Input_Layer values written through the
 * Settings_Store (design "lib/conversation/settings.ts"). Reads are Zod-validated: an invalid
 * partner field replaces the whole record with the defaults (Req 16.7), an invalid Input_Layer
 * value is replaced by its own default (Req 16.11).
 */
import { z } from 'zod';
import {
  DEFAULT_INPUT_SETTINGS,
  SOURCE_KINDS,
  validateMinPressDuration,
  validateThresholds,
  type InputSettings,
  type SourceKind,
} from '@/lib/input';
import { err, ok, type EngineConfig, type Estimates, type Result } from '@/lib/morse';

export const RATE_MIN = 0.5;
export const RATE_MAX = 2.0;
export const RATE_DEFAULT = 1.0;
export const WPM_MIN = 2;
export const WPM_MAX = 20;
export const WPM_DEFAULT = 6;

export interface SettingsRecord {
  readonly v: 1;
  /** null = the browser default voice. */
  readonly voiceURI: string | null;
  /** 0.5 to 2.0 */
  readonly speechRate: number;
  readonly flip: boolean;
  /** 2 to 20 */
  readonly startingWpm: number;
  /** true = Adaptive_Mode, false = Fixed_Speed_Mode. */
  readonly adaptive: boolean;
  /** Raw; input-sources validates it with validateSwitchKey on read. */
  readonly switchKey: unknown;
  /** Minimum press durations and blink thresholds. */
  readonly input: InputSettings;
}

export const DEFAULT_SETTINGS: SettingsRecord = Object.freeze({
  v: 1,
  voiceURI: null,
  speechRate: RATE_DEFAULT,
  flip: false,
  startingWpm: WPM_DEFAULT,
  adaptive: true,
  switchKey: null,
  input: DEFAULT_INPUT_SETTINGS,
});

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>)[key] : undefined;
}

/** Each Input_Layer value checked with the input-sources validators; an invalid value becomes its default. */
function readInputSettings(value: unknown): InputSettings {
  const durations = field(value, 'minPressDuration');
  const minPressDuration = {} as Record<SourceKind, number>;
  for (const kind of SOURCE_KINDS) {
    const checked = validateMinPressDuration(kind, field(durations, kind));
    minPressDuration[kind] = checked.ok ? checked.value : DEFAULT_INPUT_SETTINGS.minPressDuration[kind];
  }
  const close = field(value, 'closeThreshold');
  const open = field(value, 'openThreshold');
  const both = validateThresholds(close, open);
  let thresholds = both.ok ? both.value : null;
  if (!both.ok) {
    // Replace only the invalid value; if the pair is still not open < close, use both defaults.
    const bad = new Set(both.error.invalid);
    const retry = validateThresholds(
      bad.has('closeThreshold') ? DEFAULT_INPUT_SETTINGS.closeThreshold : close,
      bad.has('openThreshold') ? DEFAULT_INPUT_SETTINGS.openThreshold : open,
    );
    thresholds = retry.ok ? retry.value : null;
  }
  return {
    minPressDuration,
    closeThreshold: thresholds?.close ?? DEFAULT_INPUT_SETTINGS.closeThreshold,
    openThreshold: thresholds?.open ?? DEFAULT_INPUT_SETTINGS.openThreshold,
  };
}

/** Never fails: every invalid Input_Layer value is replaced by its default, the others are kept. */
export const InputSettingsSchema: z.ZodType<InputSettings> = z.unknown().transform(readInputSettings);

/** Partner fields strict; Input_Layer fields (switchKey, input) fall back value by value. */
export const SettingsRecordSchema = z.object({
  v: z.literal(1),
  voiceURI: z.string().min(1).nullable(),
  speechRate: z.number().min(RATE_MIN).max(RATE_MAX),
  flip: z.boolean(),
  startingWpm: z.number().min(WPM_MIN).max(WPM_MAX),
  adaptive: z.boolean(),
  switchKey: z
    .unknown()
    .optional()
    .transform((value) => (value === undefined ? null : value)),
  input: InputSettingsSchema,
});

export type SettingsPatch = Partial<
  Pick<SettingsRecord, 'voiceURI' | 'speechRate' | 'flip' | 'startingWpm' | 'adaptive'>
>;

export const WPM_RANGE_MESSAGE = 'Enter a number from 2 to 20.';
export const RATE_RANGE_MESSAGE = 'Enter a speech rate from 0.5 to 2.';

export type PatchError =
  | { readonly field: 'speechRate'; readonly value: unknown; readonly message: string }
  | { readonly field: 'startingWpm'; readonly value: unknown; readonly message: typeof WPM_RANGE_MESSAGE }
  | { readonly field: 'voiceURI'; readonly value: unknown; readonly message: string }
  | { readonly field: 'flip' | 'adaptive'; readonly value: unknown; readonly message: string };

const isNumberIn = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/**
 * Pure: the merged record when every given field is valid, otherwise the errors and no change
 * (Req 17.9, 20.6). A field that is absent or undefined is left as it is.
 */
export function validateSettingsPatch(
  current: SettingsRecord,
  patch: unknown,
): Result<SettingsRecord, readonly PatchError[]> {
  const errors: PatchError[] = [];
  const merged: { -readonly [K in keyof SettingsRecord]: SettingsRecord[K] } = { ...current };
  const given = (key: string): unknown => field(patch, key);

  const voiceURI = given('voiceURI');
  if (voiceURI !== undefined) {
    if (voiceURI === null || (typeof voiceURI === 'string' && voiceURI.length > 0)) merged.voiceURI = voiceURI;
    else errors.push({ field: 'voiceURI', value: voiceURI, message: 'Choose a voice from the list.' });
  }
  const speechRate = given('speechRate');
  if (speechRate !== undefined) {
    if (isNumberIn(speechRate, RATE_MIN, RATE_MAX)) merged.speechRate = speechRate;
    else errors.push({ field: 'speechRate', value: speechRate, message: RATE_RANGE_MESSAGE });
  }
  const startingWpm = given('startingWpm');
  if (startingWpm !== undefined) {
    if (isNumberIn(startingWpm, WPM_MIN, WPM_MAX)) merged.startingWpm = startingWpm;
    else errors.push({ field: 'startingWpm', value: startingWpm, message: WPM_RANGE_MESSAGE });
  }
  for (const key of ['flip', 'adaptive'] as const) {
    const value = given(key);
    if (value === undefined) continue;
    if (typeof value === 'boolean') merged[key] = value;
    else errors.push({ field: key, value, message: 'Choose on or off.' });
  }
  return errors.length > 0 ? err(errors) : ok(merged);
}

/** Engine configuration from the settings, plus calibrated initial estimates when given. */
export function engineConfigOf(s: SettingsRecord, initial: Estimates | null): EngineConfig {
  const base: EngineConfig = { startingWpm: s.startingWpm, mode: s.adaptive ? 'adaptive' : 'fixed' };
  return initial === null
    ? base
    : { ...base, initialDotEstimate: initial.dotEstimate, initialDashEstimate: initial.dashEstimate };
}
