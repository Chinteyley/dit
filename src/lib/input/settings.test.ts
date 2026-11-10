import { describe, expect, it } from 'vitest';
import { DEFAULT_INPUT_SETTINGS, validateInputSettings } from './settings';

describe('validateInputSettings', () => {
  it('accepts the defaults', () => {
    expect(DEFAULT_INPUT_SETTINGS).toStrictEqual({
      minPressDuration: { keyboard: 30, switch: 30, pointer: 30, blink: 200 },
      closeThreshold: 0.5,
      openThreshold: 0.35,
    });
    expect(validateInputSettings(DEFAULT_INPUT_SETTINGS)).toStrictEqual({ ok: true, value: DEFAULT_INPUT_SETTINGS });
  });

  it('names each out-of-range Min_Press_Duration', () => {
    const result = validateInputSettings({
      ...DEFAULT_INPUT_SETTINGS,
      minPressDuration: { keyboard: 501, switch: 30, pointer: -1, blink: 2001 },
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toStrictEqual([
      expect.objectContaining({ source: 'keyboard', setting: 'minPressDuration', value: 501 }),
      expect.objectContaining({ source: 'pointer', setting: 'minPressDuration', value: -1 }),
      expect.objectContaining({ source: 'blink', setting: 'minPressDuration', value: 2001 }),
    ]);
  });

  it('names invalid thresholds', () => {
    const result = validateInputSettings({ ...DEFAULT_INPUT_SETTINGS, closeThreshold: 0.3, openThreshold: 0.6 });
    expect(result).toMatchObject({ ok: false, error: [{ invalid: ['closeThreshold', 'openThreshold'] }] });
    const open = validateInputSettings({ ...DEFAULT_INPUT_SETTINGS, openThreshold: Number.NaN });
    expect(open).toMatchObject({ ok: false, error: [{ invalid: ['openThreshold'] }] });
  });

  it('rejects junk with an error per field', () => {
    for (const junk of [null, 'settings', 42, {}, { minPressDuration: 'x' }]) {
      const result = validateInputSettings(junk);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toHaveLength(5);
    }
  });
});
