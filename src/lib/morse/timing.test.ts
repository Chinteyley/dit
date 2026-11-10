import { describe, expect, it } from 'vitest';
import {
  DEFAULT_UNIT,
  DEFAULT_WPM,
  MAX_UNIT,
  MIN_UNIT,
  applyEstimateGuards,
  thresholds,
  unitToWpm,
  wpmToUnit,
} from './timing';

describe('WPM conversion', () => {
  it('uses the PARIS standard', () => {
    expect(wpmToUnit(2)).toBe(600);
    expect(wpmToUnit(6)).toBe(200);
    expect(wpmToUnit(20)).toBe(60);
    expect(unitToWpm(200)).toBe(6);
    expect(wpmToUnit(DEFAULT_WPM)).toBe(DEFAULT_UNIT);
  });
});

describe('thresholds', () => {
  it('gives 400 / 400 / 900 ms at the default 6 WPM', () => {
    expect(thresholds({ dotEstimate: 200, dashEstimate: 600 })).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 600,
      dotDashThreshold: 400,
      letterGapThreshold: 400,
      wordGapThreshold: 900,
    });
  });
});

describe('applyEstimateGuards', () => {
  it('clamps a huge dot to MAX_UNIT, then raises the dash to keep separation', () => {
    expect(applyEstimateGuards({ dotEstimate: 2000, dashEstimate: 2000 })).toStrictEqual({
      dotEstimate: MAX_UNIT,
      dashEstimate: 2250,
    });
  });

  it('clamps a tiny dash to MIN_UNIT, then raises it to 1.5 × dot', () => {
    expect(applyEstimateGuards({ dotEstimate: 100, dashEstimate: 10 })).toStrictEqual({
      dotEstimate: 100,
      dashEstimate: 150,
    });
  });

  it('clamps both estimates into [MIN_UNIT, 3 × MAX_UNIT]', () => {
    expect(applyEstimateGuards({ dotEstimate: 1, dashEstimate: 1e6 })).toStrictEqual({
      dotEstimate: MIN_UNIT,
      dashEstimate: 3 * MAX_UNIT,
    });
  });

  it('leaves valid estimates untouched', () => {
    expect(applyEstimateGuards({ dotEstimate: 200, dashEstimate: 600 })).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 600,
    });
  });
});
