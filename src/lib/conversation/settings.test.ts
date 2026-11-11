import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT_SETTINGS } from '@/lib/input';
import {
  DEFAULT_SETTINGS,
  InputSettingsSchema,
  SettingsRecordSchema,
  WPM_RANGE_MESSAGE,
  engineConfigOf,
  validateSettingsPatch,
} from './settings';

describe('DEFAULT_SETTINGS', () => {
  it('uses the browser default voice, rate 1, no flip, 6 WPM, adaptive, no learned key, input defaults', () => {
    expect(DEFAULT_SETTINGS).toEqual({
      v: 1,
      voiceURI: null,
      speechRate: 1,
      flip: false,
      startingWpm: 6,
      adaptive: true,
      switchKey: null,
      input: DEFAULT_INPUT_SETTINGS,
    });
    expect(SettingsRecordSchema.safeParse(DEFAULT_SETTINGS).success).toBe(true);
  });
});

describe('validateSettingsPatch', () => {
  it('accepts speech rates 0.5 and 2.0 and rejects 0.49 and "1"', () => {
    expect(validateSettingsPatch(DEFAULT_SETTINGS, { speechRate: 0.5 })).toEqual({
      ok: true,
      value: { ...DEFAULT_SETTINGS, speechRate: 0.5 },
    });
    expect(validateSettingsPatch(DEFAULT_SETTINGS, { speechRate: 2.0 }).ok).toBe(true);
    for (const speechRate of [0.49, '1', 2.01, Number.NaN, null]) {
      const result = validateSettingsPatch(DEFAULT_SETTINGS, { speechRate });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.map((e) => e.field)).toEqual(['speechRate']);
    }
  });

  it('accepts a decimal starting speed and rejects out-of-range ones with the range text', () => {
    expect(validateSettingsPatch(DEFAULT_SETTINGS, { startingWpm: 2.5 })).toEqual({
      ok: true,
      value: { ...DEFAULT_SETTINGS, startingWpm: 2.5 },
    });
    const result = validateSettingsPatch(DEFAULT_SETTINGS, { startingWpm: 21 });
    expect(result).toEqual({ ok: false, error: [{ field: 'startingWpm', value: 21, message: WPM_RANGE_MESSAGE }] });
    expect(WPM_RANGE_MESSAGE).toBe('Enter a number from 2 to 20.');
  });

  it('merges several valid fields and rejects the whole patch when one is invalid', () => {
    const merged = validateSettingsPatch(DEFAULT_SETTINGS, { voiceURI: 'v1', flip: true, adaptive: false });
    expect(merged).toEqual({ ok: true, value: { ...DEFAULT_SETTINGS, voiceURI: 'v1', flip: true, adaptive: false } });
    const rejected = validateSettingsPatch(DEFAULT_SETTINGS, { flip: true, startingWpm: 'fast' });
    expect(rejected.ok).toBe(false);
    expect(validateSettingsPatch(DEFAULT_SETTINGS, { voiceURI: '' }).ok).toBe(false);
    expect(validateSettingsPatch(DEFAULT_SETTINGS, { adaptive: 'yes' }).ok).toBe(false);
    expect(validateSettingsPatch(DEFAULT_SETTINGS, { voiceURI: null })).toEqual({ ok: true, value: DEFAULT_SETTINGS });
  });
});

describe('engineConfigOf', () => {
  it('maps adaptation to the Engine mode and passes estimates through', () => {
    expect(engineConfigOf(DEFAULT_SETTINGS, null)).toEqual({ startingWpm: 6, mode: 'adaptive' });
    expect(engineConfigOf({ ...DEFAULT_SETTINGS, adaptive: false, startingWpm: 10 }, null)).toEqual({
      startingWpm: 10,
      mode: 'fixed',
    });
    expect(engineConfigOf(DEFAULT_SETTINGS, { dotEstimate: 150, dashEstimate: 480 })).toEqual({
      startingWpm: 6,
      mode: 'adaptive',
      initialDotEstimate: 150,
      initialDashEstimate: 480,
    });
  });
});

describe('schemas', () => {
  it('rejects a record whose partner field is out of range', () => {
    expect(SettingsRecordSchema.safeParse({ ...DEFAULT_SETTINGS, speechRate: 3 }).success).toBe(false);
    expect(SettingsRecordSchema.safeParse({ ...DEFAULT_SETTINGS, startingWpm: 1 }).success).toBe(false);
    expect(SettingsRecordSchema.safeParse({ ...DEFAULT_SETTINGS, v: 2 }).success).toBe(false);
  });

  it('replaces only the invalid Input_Layer value with its default', () => {
    const parsed = SettingsRecordSchema.parse({
      ...DEFAULT_SETTINGS,
      input: { minPressDuration: { keyboard: 40, switch: -5, pointer: 20, blink: 300 }, closeThreshold: 0.6, openThreshold: 0.4 },
    });
    expect(parsed.input).toEqual({
      minPressDuration: { keyboard: 40, switch: 30, pointer: 20, blink: 300 },
      closeThreshold: 0.6,
      openThreshold: 0.4,
    });
  });

  it('keeps a valid open threshold when only the close threshold is invalid, and both defaults when they clash', () => {
    expect(InputSettingsSchema.parse({ closeThreshold: 7, openThreshold: 0.3 })).toMatchObject({
      closeThreshold: 0.5,
      openThreshold: 0.3,
    });
    expect(InputSettingsSchema.parse({ closeThreshold: 0.4, openThreshold: 0.45 })).toMatchObject({
      closeThreshold: 0.5,
      openThreshold: 0.35,
    });
    expect(InputSettingsSchema.parse('junk')).toEqual(DEFAULT_INPUT_SETTINGS);
  });

  it('reads a missing switch key as null and keeps any stored value raw', () => {
    const withoutKey: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    delete withoutKey.switchKey;
    expect(SettingsRecordSchema.parse(withoutKey).switchKey).toBeNull();
    expect(SettingsRecordSchema.parse({ ...DEFAULT_SETTINGS, switchKey: 42 }).switchKey).toBe(42);
  });
});
