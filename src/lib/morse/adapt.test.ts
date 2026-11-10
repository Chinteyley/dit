import { describe, expect, it } from 'vitest';
import { adaptEstimates } from './adapt';

const DEFAULTS = { dotEstimate: 200, dashEstimate: 600 } as const;

describe('adaptEstimates', () => {
  it('leaves the estimate unchanged when a dot lasts exactly the estimate', () => {
    expect(adaptEstimates(DEFAULTS, '.', 200, 0.15)).toStrictEqual(DEFAULTS);
  });

  it('clamps a very long dot to 2 × prior before the update', () => {
    // observation = 400, so dot = 200 + 0.15 × (400 − 200) = 230
    expect(adaptEstimates(DEFAULTS, '.', 10_000, 0.15)).toStrictEqual({
      dotEstimate: 230,
      dashEstimate: 600,
    });
  });

  it('clamps a very short dash to 0.5 × prior before the update', () => {
    // observation = 300, so dash = 600 + 0.15 × (300 − 600) = 555
    expect(adaptEstimates(DEFAULTS, '-', 1, 0.15)).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 555,
    });
  });

  it('raises a dash that would fall below 1.5 × dot', () => {
    // 600 + 0.15 × (300 − 600) = 555 < 1.5 × 400, so the guard sets dash to 600
    expect(adaptEstimates({ dotEstimate: 400, dashEstimate: 600 }, '-', 300, 0.15)).toStrictEqual({
      dotEstimate: 400,
      dashEstimate: 600,
    });
  });

  it('jumps to the clamped observation when alpha is 1', () => {
    expect(adaptEstimates(DEFAULTS, '-', 5000, 1)).toStrictEqual({
      dotEstimate: 200,
      dashEstimate: 1200,
    });
    expect(adaptEstimates(DEFAULTS, '.', 50, 1)).toStrictEqual({
      dotEstimate: 100,
      dashEstimate: 600,
    });
  });

  it('never lets the dot estimate leave [MIN_UNIT, MAX_UNIT]', () => {
    expect(adaptEstimates({ dotEstimate: 60, dashEstimate: 180 }, '.', 1, 1).dotEstimate).toBe(60);
    expect(adaptEstimates({ dotEstimate: 1500, dashEstimate: 4500 }, '.', 1e9, 1).dotEstimate).toBe(1500);
  });
});
