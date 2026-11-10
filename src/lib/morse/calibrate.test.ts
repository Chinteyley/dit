import { describe, expect, it } from 'vitest';
import { calibrate } from './calibrate';

describe('calibrate', () => {
  it('takes the median short press as the dot and the mean long press as the dash', () => {
    expect(calibrate([200, 210, 190, 600, 620])).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 610,
      reason: null,
    });
  });

  it('uses 3 × dot when the long presses are not clearly longer', () => {
    expect(calibrate([300, 310, 290, 350, 360])).toStrictEqual({
      dotEstimate: 300,
      dashEstimate: 900,
      reason: null,
    });
  });

  it('keeps a dash of exactly 1.5 × dot', () => {
    expect(calibrate([200, 200, 200, 300, 300])).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 300,
      reason: null,
    });
  });

  it('applies the guards to very slow or very fast presses', () => {
    expect(calibrate([2000, 2100, 1900, 5000, 5000])).toStrictEqual({
      dotEstimate: 1500,
      dashEstimate: 4500,
      reason: null,
    });
    expect(calibrate([10, 10, 10, 40, 40])).toStrictEqual({
      dotEstimate: 60,
      dashEstimate: 90,
      reason: null,
    });
  });

  it('falls back to the defaults with the received length', () => {
    expect(calibrate([])).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 600,
      reason: { kind: 'wrong-length', length: 0 },
    });
    expect(calibrate([1, 2, 3, 4, 5, 6]).reason).toStrictEqual({ kind: 'wrong-length', length: 6 });
  });

  it('falls back to the defaults with the position of the first invalid duration', () => {
    expect(calibrate([1, 2, Number.NaN, 4, 5])).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 600,
      reason: { kind: 'invalid-duration', position: 3 },
    });
    expect(calibrate([0, -1, 3, 4, 5]).reason).toStrictEqual({ kind: 'invalid-duration', position: 1 });
    expect(calibrate([1, 2, 3, 4, '5']).reason).toStrictEqual({ kind: 'invalid-duration', position: 5 });
  });

  it('reports input that is not a list', () => {
    expect(calibrate('200,210,190,600,620')).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 600,
      reason: { kind: 'not-a-list' },
    });
    expect(calibrate(undefined).reason).toStrictEqual({ kind: 'not-a-list' });
  });

  it('does not modify its input', () => {
    const presses = [210, 190, 200, 620, 600];
    calibrate(presses);
    expect(presses).toStrictEqual([210, 190, 200, 620, 600]);
  });
});
