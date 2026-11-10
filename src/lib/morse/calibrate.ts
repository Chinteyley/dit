import { DEFAULT_UNIT, applyEstimateGuards, isFiniteNumber } from './timing';
import type { Estimates } from './types';

export type CalibrationReason =
  | { readonly kind: 'not-a-list' }
  | { readonly kind: 'wrong-length'; readonly length: number }
  /** 1-based position of the first invalid duration. */
  | { readonly kind: 'invalid-duration'; readonly position: number };

export interface Calibration extends Estimates {
  /** null on success (Req 11.3). */
  readonly reason: CalibrationReason | null;
}

const PRACTICE_PRESSES = 5;

function isDuration(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function fallback(reason: CalibrationReason): Calibration {
  return { dotEstimate: DEFAULT_UNIT, dashEstimate: 3 * DEFAULT_UNIT, reason };
}

/**
 * 5 practice presses (3 short, then 2 long) → starting estimates (Req 11).
 * dot = median of the short presses, dash = mean of the long ones, or 3 × dot when the long presses
 * are not clearly longer. Never fails: invalid input returns the defaults and a reason.
 */
export function calibrate(durations: unknown): Calibration {
  if (!Array.isArray(durations)) {
    return fallback({ kind: 'not-a-list' });
  }
  const list: readonly unknown[] = durations;
  if (list.length !== PRACTICE_PRESSES) {
    return fallback({ kind: 'wrong-length', length: list.length });
  }
  const firstInvalid = list.findIndex((value) => !isDuration(value));
  if (firstInvalid !== -1) {
    return fallback({ kind: 'invalid-duration', position: firstInvalid + 1 });
  }
  const [short1 = 0, short2 = 0, short3 = 0, long1 = 0, long2 = 0] = list.filter(isDuration);
  const [, rawDot = DEFAULT_UNIT] = [short1, short2, short3].sort((a, b) => a - b);
  const meanLong = (long1 + long2) / 2;
  const rawDash = meanLong < 1.5 * rawDot ? 3 * rawDot : meanLong;
  return { ...applyEstimateGuards({ dotEstimate: rawDot, dashEstimate: rawDash }), reason: null };
}
