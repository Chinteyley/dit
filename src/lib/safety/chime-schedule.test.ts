import { describe, expect, it } from 'vitest';
import {
  CHIME_END_MS,
  CHIME_PERIOD_MS,
  MAX_CHIMES_PER_WINDOW,
  PEAK_GAIN,
  RAMP_MS,
  TONES,
  chimeSchedule,
} from './chime-schedule';

describe('Chime constants', () => {
  it('describe two tones, 880 Hz then 660 Hz 200 ms later, 150 ms each (Requirement 4.2, 4.3)', () => {
    expect(CHIME_PERIOD_MS).toBe(1000);
    expect(TONES).toEqual([
      { offsetMs: 0, hz: 880, durationMs: 150 },
      { offsetMs: 200, hz: 660, durationMs: 150 },
    ]);
    expect(PEAK_GAIN).toBe(0.8);
    expect(RAMP_MS).toBeGreaterThanOrEqual(5);
    expect(RAMP_MS).toBeLessThanOrEqual(20);
    const lastToneEnd = Math.max(...TONES.map((tone) => tone.offsetMs + tone.durationMs));
    expect(lastToneEnd).toBeLessThanOrEqual(CHIME_END_MS);
    expect(CHIME_END_MS).toBeLessThanOrEqual(400);
  });
});

describe('chimeSchedule', () => {
  it('lists s + k × 1000 inside [from, to)', () => {
    expect(chimeSchedule(500, 500, 3500)).toEqual([500, 1500, 2500]);
    expect(chimeSchedule(500, 501, 3501)).toEqual([1500, 2500, 3500]);
    expect(chimeSchedule(0, -5000, 1500)).toEqual([0, 1000]);
  });

  it('includes the window start and excludes the window end', () => {
    expect(chimeSchedule(0, 1000, 2000)).toEqual([1000]);
    expect(chimeSchedule(0, 999.5, 1000)).toEqual([]);
  });

  it('drops every time at or after the stop time', () => {
    expect(chimeSchedule(0, 0, 5000, 2000)).toEqual([0, 1000]);
    expect(chimeSchedule(0, 0, 5000, 2000.5)).toEqual([0, 1000, 2000]);
    expect(chimeSchedule(0, 1000, 5000, 1000)).toEqual([]);
    expect(chimeSchedule(100, 0, 5000, 100)).toEqual([]);
  });

  it('returns [] for invalid inputs without throwing (Requirement 5.7)', () => {
    expect(chimeSchedule(Number.NaN, 0, 1000)).toEqual([]);
    expect(chimeSchedule(0, -Infinity, 1000)).toEqual([]);
    expect(chimeSchedule(0, 0, Infinity)).toEqual([]);
    expect(chimeSchedule(0, 0, 1000, Number.NaN)).toEqual([]);
    expect(chimeSchedule(0, 1000, 1000)).toEqual([]);
    expect(chimeSchedule(0, 2000, 1000)).toEqual([]);
  });

  it('keeps 1000 ms steps for large clock values', () => {
    const s = 987_654_321.123;
    const times = chimeSchedule(s, s + 5_000_000, s + 5_004_000);
    expect(times).toHaveLength(4);
    for (let i = 1; i < times.length; i += 1) {
      expect(Math.abs((times[i] ?? 0) - (times[i - 1] ?? 0) - 1000)).toBeLessThanOrEqual(0.001);
    }
  });

  it('stops at the cap and never hangs on huge or imprecise inputs', () => {
    expect(chimeSchedule(0, 0, 1e300)).toHaveLength(MAX_CHIMES_PER_WINDOW);
    expect(chimeSchedule(-1e300, 0, 1000)).toEqual([]);
    expect(chimeSchedule(1e20, 1e20, 1e20 + 50_000).length).toBeGreaterThan(0);
  });
});
