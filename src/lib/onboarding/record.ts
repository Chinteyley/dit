/**
 * The Onboarding_Record (design "lib/onboarding/record.ts", Requirements 11 and 16.4 to 16.6):
 * exactly four fields in localStorage["dit:onboarding:v1"], read through Zod. Nothing here
 * throws, logs or sends data; the backend is injected (localStorage in the browser).
 *
 * Privacy: the record stores the Input_Choice and two numbers, never camera data, presses or text.
 */
import { z } from 'zod';
import type { KeyValueBackend } from '@/lib/conversation';
import { err, ok, type Result } from '@/lib/morse';

export const ONBOARDING_KEY = 'dit:onboarding:v1';

/** Both finite and greater than 0 (Zod 4 numbers already reject NaN and ±Infinity). */
export const EstimatesSchema = z
  .object({
    dotEstimate: z.number().gt(0),
    dashEstimate: z.number().gt(0),
  })
  .strict();

export const OnboardingRecordSchema = z
  .object({
    v: z.literal(1),
    complete: z.boolean(),
    inputChoice: z.enum(['key-tap', 'switch', 'blink']),
    estimates: EstimatesSchema.nullable(),
  })
  .strict();

export type OnboardingRecord = z.infer<typeof OnboardingRecordSchema>;

export type ReadOutcome =
  | { readonly kind: 'valid'; readonly record: OnboardingRecord }
  /** Missing, not JSON, or not a valid record (Requirement 11.2). */
  | { readonly kind: 'absent' }
  /** getItem threw, or there is no backend (Requirement 11.5). */
  | { readonly kind: 'read-error' };

/** Pure. The record when `raw` is JSON for a valid record (Requirement 11.1), else null. Never throws. */
export function parseOnboardingRecord(raw: string | null): OnboardingRecord | null {
  if (typeof raw !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = OnboardingRecordSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Pure. JSON of exactly the four fields, and of exactly the two estimate fields (Requirement 11.11). */
export function serializeOnboardingRecord(r: OnboardingRecord): string {
  return JSON.stringify({
    v: r.v,
    complete: r.complete,
    inputChoice: r.inputChoice,
    estimates: r.estimates === null ? null : { dotEstimate: r.estimates.dotEstimate, dashEstimate: r.estimates.dashEstimate },
  });
}

/** Reads and validates the record. Never writes and never throws. */
export function readOnboardingRecord(backend: KeyValueBackend | null): ReadOutcome {
  if (backend === null) return { kind: 'read-error' };
  let raw: string | null;
  try {
    raw = backend.getItem(ONBOARDING_KEY);
  } catch {
    return { kind: 'read-error' };
  }
  const record = parseOnboardingRecord(raw);
  return record === null ? { kind: 'absent' } : { kind: 'valid', record };
}

const sameRecord = (a: OnboardingRecord, b: OnboardingRecord): boolean =>
  a.v === b.v &&
  a.complete === b.complete &&
  a.inputChoice === b.inputChoice &&
  (a.estimates === null || b.estimates === null
    ? a.estimates === b.estimates
    : a.estimates.dotEstimate === b.estimates.dotEstimate && a.estimates.dashEstimate === b.estimates.dashEstimate);

/**
 * setItem, then reads the value back; ok only when it parses to the same record (Requirement 16.6).
 * A failed setItem leaves the stored value as it was. Never throws.
 */
export function writeOnboardingRecord(backend: KeyValueBackend | null, r: OnboardingRecord): Result<void, 'write-failed'> {
  if (backend === null) return err('write-failed');
  try {
    backend.setItem(ONBOARDING_KEY, serializeOnboardingRecord(r));
    const back = parseOnboardingRecord(backend.getItem(ONBOARDING_KEY));
    return back !== null && sameRecord(back, r) ? ok(undefined) : err('write-failed');
  } catch {
    return err('write-failed');
  }
}
