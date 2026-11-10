/**
 * The Chime_Schedule (design "lib/safety/chime-schedule.ts", Requirement 5): a pure function of the
 * alarm start time that lists the Chime start times inside a window, plus the tone constants the
 * Web Audio adapter plays. All times are audio-clock milliseconds.
 */

/** Start of one Chime to the start of the next (Requirement 5.4). */
export const CHIME_PERIOD_MS = 1000;

/** The two tones of one Chime (Requirement 4.2). */
export const TONES = Object.freeze([
  Object.freeze({ offsetMs: 0, hz: 880, durationMs: 150 }),
  Object.freeze({ offsetMs: 200, hz: 660, durationMs: 150 }),
] as const);

/** Peak gain of each tone, of full scale (Requirement 4.3). */
export const PEAK_GAIN = 0.8;
/** Attack and release ramp of each tone, inside [5, 20] ms (Requirement 4.3). */
export const RAMP_MS = 10;
/** The last tone ends at 350 ms including release; the oscillators stop at 360 ms (≤ 400, Requirement 4.2). */
export const CHIME_END_MS = 360;

/**
 * No call returns more than this many times (about 28 hours of Chimes). The Chime_Player asks for
 * windows of at most 70 s, so the cap only guarantees that an absurd window cannot hang the alarm.
 */
export const MAX_CHIMES_PER_WINDOW = 100_000;

const at = (s: number, k: number): number => s + k * CHIME_PERIOD_MS;

/**
 * Pure. Start times s + k × 1000 (k ≥ 0, integer) with from ≤ t < to and, when x is given, t < x,
 * in ascending order. Each time is computed directly from s and k, never by repeated addition, so
 * splitting a window never repeats or skips a Chime (Requirement 5.6). Invalid inputs give [].
 */
export function chimeSchedule(s: number, from: number, to: number, x?: number): readonly number[] {
  if (!Number.isFinite(s) || !Number.isFinite(from) || !Number.isFinite(to)) return [];
  if (x !== undefined && !Number.isFinite(x)) return [];
  if (to <= from) return [];
  const end = x === undefined ? to : Math.min(to, x);
  if (end <= s || end <= from) return [];

  let k = Math.max(0, Math.ceil((from - s) / CHIME_PERIOD_MS));
  // An index this large has lost integer precision; no audio clock ever gets near it.
  if (!Number.isSafeInteger(k)) return [];
  // Correct the floating-point estimate so k is the smallest index with s + k × 1000 ≥ from.
  while (k > 0 && at(s, k - 1) >= from) k -= 1;
  while (at(s, k) < from) k += 1;

  const times: number[] = [];
  for (; at(s, k) < end && times.length < MAX_CHIMES_PER_WINDOW; k += 1) times.push(at(s, k));
  return times;
}
