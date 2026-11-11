import type { Estimates, EstimateSnapshot } from './types';

/** Smallest unit any estimate may reach, in ms (20 WPM). */
export const MIN_UNIT = 60;
/** Largest dot estimate, in ms. Blink users can be very slow. */
export const MAX_UNIT = 1500;
export const DEFAULT_WPM = 6;
/** 1200 / DEFAULT_WPM. */
export const DEFAULT_UNIT = 200;
export const MIN_START_WPM = 2;
export const MAX_START_WPM = 20;
export const DEFAULT_ADAPTATION_RATE = 0.15;
/** The 10th symbol in the pattern buffer forces an unknown commit: no code is longer than SOS (9). */
export const MAX_SYMBOLS = 10;

/** PARIS standard: one unit lasts 1200 / WPM milliseconds. */
const PARIS_MS = 1200;

export function wpmToUnit(wpm: number): number {
  return PARIS_MS / wpm;
}

export function unitToWpm(unit: number): number {
  return PARIS_MS / unit;
}

export function thresholds(e: Estimates, startingUnit = DEFAULT_UNIT): EstimateSnapshot {
  const gapUnit = Math.max(e.dotEstimate, startingUnit);
  return {
    dotEstimate: e.dotEstimate,
    dashEstimate: e.dashEstimate,
    dotDashThreshold: (e.dotEstimate + e.dashEstimate) / 2,
    letterGapThreshold: 2 * gapUnit,
    wordGapThreshold: 4.5 * gapUnit,
  };
}

/**
 * Estimate_Guards, in order:
 * 1. clamp both to [MIN_UNIT, 3 × MAX_UNIT]
 * 2. dot = min(dot, MAX_UNIT)
 * 3. dash = max(dash, 1.5 × dot)
 * Idempotent: step 3 yields dash ≤ 1.5 × 1500 = 2250 ≤ 4500, so a second pass changes nothing.
 */
export function applyEstimateGuards(e: Estimates): Estimates {
  const dot = Math.min(clamp(e.dotEstimate, MIN_UNIT, 3 * MAX_UNIT), MAX_UNIT);
  const dash = clamp(e.dashEstimate, MIN_UNIT, 3 * MAX_UNIT);
  const minDash = 1.5 * dot;
  return { dotEstimate: dot, dashEstimate: dash < minDash ? minDash : dash };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** A real number: rejects NaN, ±Infinity and non-numbers from untyped callers. */
export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
